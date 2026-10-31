import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scripts } from './scripts.js';
import { collectorEnvironment, collectorCommand, parseCollectorResult, WindowsCollectorRunner } from './runner.js';
import { isFailedService } from './service-health.js';
import { WindowsLiveHost } from './live.js';

// Fixed-program lexical guard: ignore data strings, then inspect command positions.
// Reject aliases/dynamic invocation too, so adding a new bare command cannot
// silently reintroduce module-wide command discovery.
const commandModules: Record<string, string> = {
  'ConvertFrom-Json': 'Microsoft.PowerShell.Utility', 'ConvertTo-Json': 'Microsoft.PowerShell.Utility',
  'Select-Object': 'Microsoft.PowerShell.Utility', 'Measure-Object': 'Microsoft.PowerShell.Utility', 'Get-Date': 'Microsoft.PowerShell.Utility',
  'Where-Object': 'Microsoft.PowerShell.Core', 'ForEach-Object': 'Microsoft.PowerShell.Core',
  'Get-CimInstance': 'CimCmdlets', 'Get-NetTCPConnection': 'NetTCPIP', 'Get-NetUDPEndpoint': 'NetTCPIP', 'Get-WinEvent': 'Microsoft.PowerShell.Diagnostics',
};
const language = new Set(['try', 'catch', 'if', 'else', 'elseif', 'foreach', 'throw', 'break', 'continue', 'exit']);
function unqualifiedCommands(program: string): string[] {
  const code = program.replace(/'(?:''|[^'])*'|"(?:`.|[^"])*"/g, ' ');
  const invalid: string[] = [];
  if (/(?:^|[;|])\s*[%?](?:\s|[{])|[&]/.test(code)) invalid.push('dynamic-or-alias-invocation');
  for (const match of code.matchAll(/(?:^|[;|=({}])\s*([A-Za-z][A-Za-z0-9_.-]*(?:\\[A-Za-z][A-Za-z0-9-]*)?)(?=\s|[;|(){}]|$)/g)) {
    const token = match[1];
    if (language.has(token.toLowerCase()) || code.slice(match.index! + match[0].length).trimStart().startsWith('=')) continue;
    const [module, command] = token.split('\\');
    if (!command || commandModules[command] !== module) invalid.push(token);
  }
  return invalid;
}

describe('fixed Windows collectors', () => {
  it('keeps hostile Unicode filter text solely in stdin and clears preload/credential environment', () => {
    const data = { query: "日本語';$(Start-Process x);`\n" };
    const command = collectorCommand('services', data);
    expect(command.stdin).toBe(JSON.stringify(data));
    expect(command.args.join(' ')).not.toContain('Start-Process x');
    expect(command.args).toContain('-NoProfile');
    expect(command.args.join(' ').length).toBeLessThan(30000);
    expect(collectorEnvironment('C:\\Windows\\System32')).toEqual({ SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: 'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0', PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' });
    for (const script of Object.values(scripts)) expect(script).not.toMatch(/Invoke-Expression|iex |-Command \$/i);
  });
  it('qualifies every native command with its reviewed module and rejects discovery regressions', () => {
    for (const program of Object.values(scripts)) expect(unqualifiedCommands(program)).toEqual([]);
    for (const [command, module] of Object.entries(commandModules)) {
      const qualified = `${module}\\${command}`;
      const program = Object.values(scripts).find((script) => script.includes(qualified));
      expect(program, command).toBeDefined();
      expect(unqualifiedCommands(program!.replace(qualified, command)), command).toContain(command);
    }
    expect(unqualifiedCommands('$p=gc file')).toContain('gc');
    expect(unqualifiedCommands('$p=Get-UnknownThing')).toContain('Get-UnknownThing');
  });
  it('uses only .NET primitives before explicitly reading JSON stdin', () => {
    for (const id of Object.keys(scripts) as Array<keyof typeof scripts>) {
      const command = collectorCommand(id, {});
      const program = Buffer.from(command.args.at(-1)!, 'base64').toString('utf16le');
      const initialization = program.slice(0, program.indexOf('[Console]::In.ReadToEnd()'));
      expect(initialization).not.toContain('New-Object');
      expect(initialization).toContain('[System.Text.UTF8Encoding]::new($false)');
      expect(program.indexOf('ConvertFrom-Json')).toBeGreaterThan(program.indexOf('[Console]::In.ReadToEnd()'));
    }
  });
  it('rejects malformed results and reports denied/partial data without manufacturing healthy evidence', () => {
    expect(() => parseCollectorResult('not json')).toThrow('invalid');
    expect(() => parseCollectorResult('{"items":[],"truncated":false,"status":"unexpected"}')).toThrow('invalid');
    expect(parseCollectorResult('{"items":[],"truncated":false,"status":"permission_denied"}').status).toBe('permission_denied');
    expect(parseCollectorResult('{"items":[],"truncated":true,"status":"partial"}').truncated).toBe(true);
  });
  it('validates native fields, nulls irrelevant service-specific codes and bounds rows', async () => {
    const runner = { run: async () => ({ items: [{ name: '示例;$(x)', display_name: '示例', state: 'Stopped', start_mode: 'Manual', process_id: 0, exit_code: 1067, service_specific_exit_code: 99 }], status: 'partial' as const, truncated: true }), stop: async () => undefined };
    const host = new WindowsLiveHost([], runner);
    const result = await host.listServices({ limit: 1 });
    expect(result.items[0].service_specific_exit_code).toBeNull();
    expect(result.health.status).toBe('partial'); expect(result.omitted_count).toBeGreaterThan(0);
    runner.run = async () => ({ items: [{ name: 'bad' }] as never, status: 'partial' as const, truncated: true });
    await expect(host.listServices({ limit: 1 })).rejects.toThrow('invalid');
  });
  it('normalizes the explicitly synthetic SCM fixture without false failures', async () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/synthetic-services.json', import.meta.url), 'utf8'));
    expect(fixture.provenance.native_qualification).toBe(false);
    const host = new WindowsLiveHost([], { run: async () => parseCollectorResult(JSON.stringify(fixture.result)), stop: async () => undefined });
    const result = await host.listServices({ limit: 200 });
    expect(result.items.filter(isFailedService).map((item) => item.name)).toEqual(['SyntheticAborted', 'SyntheticSpecific']);
    expect(result.items.find((item) => item.name === 'SyntheticSpecific')!.service_specific_exit_code).toBe(42);
  });
  it('rejects unsupported live hosts and aborts already-cancelled collection', async () => {
    if (process.platform !== 'win32') expect(() => new WindowsCollectorRunner()).toThrow('Windows');
    const controller = new AbortController(); controller.abort();
    const host = new WindowsLiveHost([], { run: async (_script, _data, signal) => { if (signal?.aborted) throw new Error('cancelled'); return { items: [], status: 'ok', truncated: false }; }, stop: async () => undefined });
    await expect(host.listServices({ limit: 1 }, controller.signal)).rejects.toThrow('cancelled');
    await expect(host.queryLogs({ channel: 'Application', limit: 1, byte_limit: 1024 })).rejects.toThrow('locally allowed');
  });
});

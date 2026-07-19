import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseFilesystemOutput } from './filesystems.js';
import { journalArgs, parseJournalOutput } from './journal.js';
import { parseProcStatus } from './procfs.js';
import { parseSocketOutput } from './sockets.js';
import { parseSystemdUnits } from './systemd.js';

async function fixture(family: 'debian' | 'rhel', name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${family}/${name}`, import.meta.url), 'utf8');
}

describe.each(['debian', 'rhel'] as const)('%s replay fixtures', (family) => {
  it('parses GNU filesystem capacity', async () => {
    const parsed = parseFilesystemOutput(await fixture(family, 'df.txt'));
    expect(parsed.get('/')?.type).toMatch(/ext4|xfs/);
    expect(parsed.get('/')?.total).toBeGreaterThan(0);
  });

  it('parses systemd unit rows without locale-dependent headings', async () => {
    const parsed = parseSystemdUnits(await fixture(family, 'systemctl.txt'));
    expect(parsed.length).toBe(3);
    expect(parsed[0].unit).toMatch(/\.service$/);
    expect(parsed[0].description.length).toBeGreaterThan(0);
  });

  it('normalizes and redacts journal records while ignoring hostile lines', async () => {
    const parsed = parseJournalOutput(await fixture(family, 'journal.jsonl'), 100, 256 * 1024);
    expect(parsed.entries.length).toBe(2);
    expect(parsed.invalidCount).toBe(family === 'rhel' ? 1 : 0);
    expect(parsed.entries.map((entry) => entry.message).join(' ')).not.toMatch(/super-secret-token|topsecretvalue/);
    expect(parsed.entries[0].timestamp).toMatch(/^2025-/);
  });

  it('always scopes journal queries to the exact local unit allowlist', () => {
    const args = journalArgs(new Set(['zeta.service', 'alpha.service']), { limit: 100 });
    expect(args.filter((value) => value === '--unit')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining(['alpha.service', 'zeta.service']));
    expect(() => journalArgs(new Set(), { limit: 100 })).toThrow(/No journal units/);
    expect(() => journalArgs(new Set(['alpha.service']), { unit: 'zeta.service', limit: 100 })).toThrow(/not locally allowed/);
  });

  it('parses IPv4 and IPv6 listener ownership as partial when unavailable', async () => {
    const parsed = parseSocketOutput('tcp', await fixture(family, 'ss.txt'));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].port).toBeGreaterThan(0);
    expect(parsed.some((item) => item.address.includes(':'))).toBe(true);
    if (family === 'rhel') expect(parsed.some((item) => item.ownership_status === 'unavailable')).toBe(true);
  });

  it('parses procfs status records without environment access', async () => {
    const parsed = parseProcStatus(await fixture(family, 'proc-status.txt'));
    expect(parsed.Name).toBeTruthy();
    expect(parsed.Uid).toMatch(/^\d+/);
    expect(parsed.VmRSS).toContain('kB');
  });
});

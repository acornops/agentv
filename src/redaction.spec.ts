import { describe, expect, it } from 'vitest';
import { redactString, redactValue } from './redaction.js';

describe('redaction', () => {
  it('redacts recursive keys and common structured secret forms', () => {
    const value = redactValue({ password: 'plain', nested: { api_key: 'key', safe: 'ok' } }) as any;
    expect(value).toEqual({ password: '<redacted>', nested: { api_key: '<redacted>', safe: 'ok' } });
  });
  it('redacts bearer, JWT, cloud, shell, assignment, and URL credentials', () => {
    expect(redactString('Bearer abc.def-123')).not.toContain('abc.def-123');
    expect(redactString('eyJabc.def.ghi')).toContain('<redacted-jwt>');
    expect(redactString('AKIAABCDEFGHIJKLMNOP')).toContain('<redacted-cloud-key>');
    expect(redactString('--password hunter2 token=abc')).not.toContain('hunter2');
    expect(redactString('postgres://user:pass@db/test?password=secret')).not.toContain('pass@');
    expect(redactString('jdbc:postgresql://user:hunter2@db/test')).not.toContain('hunter2');
    expect(redactString('AccountKey=azure-secret SharedAccessSignature=signature-value')).not.toContain('azure-secret');
    expect(redactString('ghp_123456789012345678901234567890')).toContain('<redacted-token>');
    expect(redactString('{"password":"json-secret","safe":"visible"}')).not.toContain('json-secret');
    expect(redactString('connect to https://user:hunter2@example.test/path?api_key=query-secret now')).not.toMatch(/hunter2|query-secret/);
  });
});

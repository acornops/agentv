import { describe, expect, it } from 'vitest';
import { boundedProjection, fullToolResultOutputSchema, MODEL_CONTEXT_MAX_BYTES, validateModelContext } from './model-context.js';

describe('model context contracts', () => {
  it('advertises both typed success data and the standard error shape', () => {
    const schema = fullToolResultOutputSchema({ type: 'object', required: ['ok'], properties: { ok: { const: true } } });
    expect((schema.properties as any).data.oneOf).toHaveLength(2);
    expect((schema.properties as any).data.oneOf[1].required).toEqual(['code', 'message', 'retryable']);
  });

  it('deterministically bounds nested arrays and large strings', () => {
    const source = {
      entries: Array.from({ length: 500 }, (_, index) => ({ index, message: 'secret-safe '.repeat(2_000) })),
      nested: { value: 'x'.repeat(100_000) },
    };
    const context = boundedProjection('query_logs', source, 'Bounded log result');
    expect(() => validateModelContext(context)).not.toThrow();
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(MODEL_CONTEXT_MAX_BYTES);
    expect(context.omissions.length).toBeGreaterThan(0);
    expect(boundedProjection('query_logs', source, 'Bounded log result')).toEqual(context);
  });
});

import { z } from 'zod';

/** Advertise accepted inputs, preserving optional defaults and pre-transform constraints. */
export function zodToJsonSchema(type: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(type, { io: 'input', target: 'draft-2020-12' });
}

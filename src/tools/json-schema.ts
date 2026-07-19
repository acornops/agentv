import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

function unwrap(type: z.ZodTypeAny): { schema: z.ZodTypeAny; required: boolean } {
  let current = type;
  let required = true;
  while (true) {
    const name = (current as { _def?: { typeName?: string } })._def?.typeName;
    if (name === z.ZodFirstPartyTypeKind.ZodOptional || name === z.ZodFirstPartyTypeKind.ZodDefault) {
      required = false;
      current = (current as unknown as { _def: { innerType: z.ZodTypeAny } })._def.innerType;
    } else if (name === z.ZodFirstPartyTypeKind.ZodEffects) {
      current = (current as unknown as { _def: { schema: z.ZodTypeAny } })._def.schema;
    } else {
      return { schema: current, required };
    }
  }
}

function convert(type: z.ZodTypeAny): JsonSchema {
  const name = (type as { _def?: { typeName?: string } })._def?.typeName;
  if (name === z.ZodFirstPartyTypeKind.ZodString) {
    const result: JsonSchema = { type: 'string' };
    for (const check of (type as any)._def.checks || []) {
      if (check.kind === 'min') result.minLength = check.value;
      if (check.kind === 'max') result.maxLength = check.value;
      if (check.kind === 'regex') result.pattern = check.regex.source;
      if (check.kind === 'datetime') result.format = 'date-time';
    }
    return result;
  }
  if (name === z.ZodFirstPartyTypeKind.ZodNumber) {
    const result: JsonSchema = { type: 'number' };
    for (const check of (type as any)._def.checks || []) {
      if (check.kind === 'int') result.type = 'integer';
      if (check.kind === 'min') result.minimum = check.value;
      if (check.kind === 'max') result.maximum = check.value;
    }
    return result;
  }
  if (name === z.ZodFirstPartyTypeKind.ZodBoolean) return { type: 'boolean' };
  if (name === z.ZodFirstPartyTypeKind.ZodLiteral) return { const: (type as any)._def.value };
  if (name === z.ZodFirstPartyTypeKind.ZodEnum) return { type: 'string', enum: [...(type as any).options] };
  if (name === z.ZodFirstPartyTypeKind.ZodArray) return { type: 'array', items: convert((type as any).element) };
  if (name === z.ZodFirstPartyTypeKind.ZodNullable) return { anyOf: [convert((type as any)._def.innerType), { type: 'null' }] };
  if (name === z.ZodFirstPartyTypeKind.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, raw] of Object.entries((type as any).shape)) {
      const item = unwrap(raw as z.ZodTypeAny);
      properties[key] = convert(item.schema);
      if (item.required) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  return {};
}

/** Convert the supported strict Zod subset into advertised JSON Schema. */
export function zodToJsonSchema(type: z.ZodTypeAny): JsonSchema {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...convert(type) };
}

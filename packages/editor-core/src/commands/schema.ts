import type { JsonObject, JsonValue } from '../common/json.js';

type MutableJson = Record<string, JsonValue>;

/**
 * Minimal JSON-Schema builders for `ParamsSchema.describe()`. Deliberately
 * tiny: commands hand-validate (see validate.ts); these only document the
 * shape for LLM tool definitions and command help. Keep the two in sync.
 */
export const S = {
  object(
    properties: Record<string, JsonObject>,
    required: readonly string[] = [],
    description?: string,
  ): JsonObject {
    const schema: MutableJson = {
      type: 'object',
      properties,
      required: [...required],
    };
    if (description) schema['description'] = description;
    return schema;
  },

  number(description?: string): JsonObject {
    return description ? { type: 'number', description } : { type: 'number' };
  },

  string(description?: string): JsonObject {
    return description ? { type: 'string', description } : { type: 'string' };
  },

  boolean(description?: string): JsonObject {
    return description ? { type: 'boolean', description } : { type: 'boolean' };
  },

  /** entity/store id — branded strings on the TS side, plain strings here */
  id(description: string): JsonObject {
    return { type: 'string', description };
  },

  enum(values: readonly (string | number)[], description?: string): JsonObject {
    const schema: MutableJson = { enum: [...values] };
    if (description) schema['description'] = description;
    return schema;
  },

  array(items: JsonObject, description?: string): JsonObject {
    const schema: MutableJson = { type: 'array', items };
    if (description) schema['description'] = description;
    return schema;
  },

  point(description = 'a 2D point in world meters'): JsonObject {
    return {
      type: 'object',
      description,
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    };
  },
};

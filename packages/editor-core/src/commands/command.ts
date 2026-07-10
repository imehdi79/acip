import type { JsonObject } from '../common/json.js';
import type { DrawingDocument } from '../document/document.js';
import type { Transaction } from '../document/history/transaction.js';

/**
 * One schema, three consumers: runtime validation, command-line parsing,
 * LLM tool definition (describe()). Zod or similar can adapt to this shape.
 */
export interface ParamsSchema<P> {
  /** returns validated params or throws ValidationError */
  validate(input: unknown): P;
  /** JSON-schema-ish description — becomes the agent tool definition */
  describe?(): JsonObject;
}

export function paramsSchema<P>(
  validate: (input: unknown) => P,
  describe?: () => JsonObject,
): ParamsSchema<P> {
  return describe ? { validate, describe } : { validate };
}

export interface CommandContext {
  readonly doc: DrawingDocument;
  /** opened by the bus — commands never commit or roll back themselves */
  readonly tx: Transaction;
}

/**
 * Non-interactive by design: complete validated params in, result out.
 * Interactivity lives in tools/, which gather input then dispatch commands —
 * humans and agents converge on this one code path.
 */
export interface Command<P = unknown, R = unknown> {
  readonly name: string;
  readonly params: ParamsSchema<P>;
  execute(ctx: CommandContext, params: P): R;
}

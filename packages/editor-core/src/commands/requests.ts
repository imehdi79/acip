import { ValidationError } from '../common/errors.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';

function asText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export const REQUEST_KINDS = ['missing-feature', 'missing-price'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export interface LogRequestParams {
  kind: RequestKind;
  text: string;
  context?: string;
}

/**
 * A signal command: it mutates nothing in the document — its whole purpose is
 * to exist on the command bus so agents (and UIs) have a validated way to say
 * "the user wanted something the toolset can't deliver". Consumers observe the
 * dispatch (web-editor forwards it to editor-server's request log); the
 * document stays untouched, so undoing a drawing never erases the record.
 */
export const LogRequestCommand: Command<LogRequestParams, string> = {
  name: 'REQUEST.LOG',
  description:
    'Record a user request the current toolset cannot fulfil — an element type, ' +
    'operation, or price that does not exist yet. Call this once per gap when the ' +
    'user asks for something you have no tool for, then continue with what you can ' +
    'do and mention that the request was recorded.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const kind = raw['kind'];
      if (kind !== 'missing-feature' && kind !== 'missing-price') {
        throw new ValidationError(`kind must be one of ${REQUEST_KINDS.join(', ')}`);
      }
      const params: LogRequestParams = { kind, text: asText(raw['text'], 'text') };
      if (raw['context'] !== undefined) params.context = asText(raw['context'], 'context');
      return params;
    },
    () =>
      S.object(
        {
          kind: S.enum(REQUEST_KINDS, 'missing-feature = no tool for it; missing-price = no rate for it'),
          text: S.string('short description of what the user asked for, in their words'),
          context: S.string('optional detail: dimensions, level, material names involved'),
        },
        ['kind', 'text'],
      ),
  ),
  execute(_ctx, params) {
    return `recorded: ${params.kind} — ${params.text}`;
  },
};

export function registerRequestCommands(registry: CommandRegistry): void {
  registry.register(LogRequestCommand);
}

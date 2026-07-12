import type { JsonObject } from '../common/json.js';
import type { CommandRegistry } from '../commands/command-registry.js';

/**
 * LLM tool definition in the Anthropic Messages API shape (the reference
 * protocol; other providers adapt trivially). One command registration =
 * one agent-callable tool — the agent API IS the command registry.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JsonObject;
}

/**
 * Command names use dots ("WALL.ADD"); tool names must match
 * ^[a-zA-Z0-9_-]+$ — dots map to underscores, both ways. Command names
 * never contain underscores by convention, so the mapping is lossless.
 */
export function toolNameFromCommand(commandName: string): string {
  return commandName.replace(/\./g, '_');
}

export function commandNameFromTool(toolName: string): string {
  return toolName.replace(/_/g, '.');
}

const EMPTY_SCHEMA: JsonObject = { type: 'object', properties: {} };

/**
 * Project the command registry into an LLM tool catalog. Commands without a
 * describe() still appear (an agent may call them blind and learn from
 * validation errors), flagged by an empty schema.
 */
export function toolDefinitions(registry: CommandRegistry): ToolDefinition[] {
  return registry.list().map((name) => {
    const command = registry.get(name);
    return {
      name: toolNameFromCommand(name),
      description: command.description ?? `Dispatch the ${name} command.`,
      input_schema: command.params.describe?.() ?? EMPTY_SCHEMA,
    };
  });
}

export type { Command, CommandContext, ParamsSchema } from './command.js';
export { paramsSchema } from './command.js';
export { CommandRegistry } from './command-registry.js';
export { CommandBus } from './bus.js';
export type { AddLineParams, MoveParams, EraseParams } from './builtin.js';
export {
  AddLineCommand,
  MoveCommand,
  EraseCommand,
  registerBuiltinCommands,
} from './builtin.js';

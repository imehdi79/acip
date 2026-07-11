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
export type { AddWallParams, AddWindowParams } from './architecture.js';
export {
  AddWallCommand,
  AddWindowCommand,
  registerArchitectureCommands,
} from './architecture.js';
export { asPoint, asIdArray, asId, asNumber, asPositive } from './validate.js';

export type { Command, CommandContext, ParamsSchema } from './command.js';
export { paramsSchema } from './command.js';
export { CommandRegistry } from './command-registry.js';
export { CommandBus } from './bus.js';
export type { AddLineParams, MoveParams, EraseParams, GripMoveParams } from './builtin.js';
export {
  AddLineCommand,
  MoveCommand,
  EraseCommand,
  GripMoveCommand,
  registerBuiltinCommands,
} from './builtin.js';
export type { AddWallParams, AddWindowParams, AddDoorParams } from './architecture.js';
export {
  AddWallCommand,
  AddWindowCommand,
  AddDoorCommand,
  registerArchitectureCommands,
} from './architecture.js';
export type {
  AddLevelParams,
  UpdateLevelParams,
  RemoveLevelParams,
  AddLayerParams,
  UpdateLayerParams,
  RemoveLayerParams,
  AddMaterialParams,
  AddTypeParams,
} from './document-stores.js';
export {
  AddLevelCommand,
  UpdateLevelCommand,
  RemoveLevelCommand,
  AddLayerCommand,
  UpdateLayerCommand,
  RemoveLayerCommand,
  AddMaterialCommand,
  AddTypeCommand,
  registerDocumentStoreCommands,
} from './document-stores.js';
export { asPoint, asIdArray, asId, asNumber, asPositive } from './validate.js';
export { S } from './schema.js';

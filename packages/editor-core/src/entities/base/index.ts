export { Entity } from './entity.js';
export type { EntityData } from './data.js';
export type { SnapKind, SnapPoint } from './snap.js';
export type {
  Anchor,
  Placement,
  PlacementParams,
  IHost,
  IHosted,
  ILevelAware,
  IMeshable,
  IOpeningCutter,
  OpeningSpec,
  GripPoint,
  IGrippable,
} from './capabilities.js';
export {
  isHost,
  isHosted,
  isLevelAware,
  isMeshable,
  cutsOpening,
  hasGrips,
} from './capabilities.js';

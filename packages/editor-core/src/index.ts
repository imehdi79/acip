/**
 * Curated public API — everything exported here is a compatibility promise
 * and the seed of the future @acip/editor-sdk. Export deliberately, never *
 * from internal modules that aren't ready to be contract.
 */

// ── common ──
export type {
  Brand,
  EntityId,
  LayerId,
  LevelId,
  MaterialId,
  TypeId,
  RelationId,
  Listener,
  JsonPrimitive,
  JsonValue,
  JsonObject,
} from './common/index.js';
export {
  newEntityId,
  newLayerId,
  newLevelId,
  newMaterialId,
  newTypeId,
  newRelationId,
  TypedEventEmitter,
  EPSILON,
  nearlyEqual,
  nearlyZero,
  CoreError,
  ValidationError,
  RegistryError,
  TransactionError,
  DocumentError,
  RelationError,
} from './common/index.js';

// ── geometry (Layer 1) ──
export type {
  Point,
  Vector,
  Matrix3,
  BBox,
  Geometry,
  SegmentShape,
  PolylineShape,
  CircleShape,
  ArcShape,
  RegionShape,
  GroupShape,
  IntersectFn,
  Mesh3D,
  MeshDetail,
} from './geometry/index.js';
export {
  point,
  ORIGIN,
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  distance,
  midpoint,
  lerp,
  normalize,
  perpendicular,
  angleOf,
  IDENTITY,
  multiply,
  translation,
  rotation,
  scaling,
  applyToPoint,
  applyToVector,
  bboxFromPoints,
  bboxUnion,
  bboxExpand,
  bboxContainsPoint,
  bboxIntersects,
  bboxCenter,
  geometryBBox,
  intersect,
  registerIntersection,
  closestParamOnSegment,
  closestPointOnSegment,
  distanceToSegment,
  EMPTY_MESH,
  extrudeQuad,
  mergeMeshes,
} from './geometry/index.js';
export type { Loop, BoundaryWithHoles, Interval } from './topology/index.js';
export { mergeIntervals, subtractIntervals } from './topology/index.js';

// ── entities (Layer 2) ──
export type {
  EntityData,
  SnapKind,
  SnapPoint,
  Anchor,
  Placement,
  PlacementParams,
  IHost,
  IHosted,
  ILevelAware,
  IMeshable,
  IOpeningCutter,
  OpeningSpec,
} from './entities/index.js';
export {
  Entity,
  isHost,
  isHosted,
  isLevelAware,
  isMeshable,
  cutsOpening,
  LineEntity,
  createLineEntity,
  WallEntity,
  createWallEntity,
  WindowEntity,
  createWindowEntity,
} from './entities/index.js';

// ── document (Layer 2) ──
export type {
  DocumentChangeEvent,
  DocumentEvents,
  Layer,
  Level,
  Material,
  MaterialUnit,
  AssemblyLayer,
  EntityTypeDef,
  SpatialIndex,
  CommitRecord,
  Transaction,
} from './document/index.js';
export {
  DrawingDocument,
  DEFAULT_LAYER_ID,
  LevelTable,
  MaterialLibrary,
  TypeCatalog,
  HistoryStack,
} from './document/index.js';

// ── relations (Layer 2) ──
export type { Relation, RelationChange } from './relations/index.js';
export { RelationGraph } from './relations/index.js';

// ── registry (Layer 2) ──
export type { EntityTypeRegistration } from './registry/index.js';
export { EntityTypeRegistry } from './registry/index.js';

// ── commands (Layer 3) ──
export type {
  Command,
  CommandContext,
  ParamsSchema,
  AddLineParams,
  MoveParams,
  EraseParams,
  AddWallParams,
  AddWindowParams,
} from './commands/index.js';
export {
  paramsSchema,
  CommandRegistry,
  CommandBus,
  AddLineCommand,
  MoveCommand,
  EraseCommand,
  registerBuiltinCommands,
  AddWallCommand,
  AddWindowCommand,
  registerArchitectureCommands,
  asPoint,
  asIdArray,
  asId,
  asNumber,
  asPositive,
} from './commands/index.js';

// ── engine systems (Layer 3) ──
export type { SelectionEvents } from './selection/index.js';
export { SelectionSet } from './selection/index.js';
export { SnapEngine } from './snapping/index.js';
export { MeasurementService, geometryLength, geometryArea } from './measurements/index.js';
export type { ViewDefinition } from './views/index.js';
export { entitiesInView } from './views/index.js';
export type { DisplayStyle, RenderItem, Renderer } from './rendering/index.js';
export { buildDisplayList } from './rendering/index.js';
export type { InputModifiers, ToolInputEvent, ToolContext, Tool } from './tools/index.js';
export type { DocumentData } from './io/index.js';
export { saveDocument, loadDocument } from './io/index.js';

// ── facade (Layer 4) ──
export type { EditorSessionOptions } from './editor/index.js';
export { EditorSession } from './editor/index.js';

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
export { transformGeometry } from './geometry/shapes.js';
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
export type { Loop, BoundaryWithHoles, Interval, WallEnd, EndCap } from './topology/index.js';
export {
  mergeIntervals,
  subtractIntervals,
  resolveJunction,
  resolveTeeCap,
  JOIN_TOLERANCE,
} from './topology/index.js';

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
  GripPoint,
  IGrippable,
} from './entities/index.js';
export {
  Entity,
  isHost,
  isHosted,
  isLevelAware,
  isMeshable,
  cutsOpening,
  hasGrips,
  LineEntity,
  createLineEntity,
  HostedOpeningEntity,
  WallEntity,
  createWallEntity,
  WindowEntity,
  createWindowEntity,
  DoorEntity,
  createDoorEntity,
} from './entities/index.js';

// ── document (Layer 2) ──
export type {
  DocumentChangeEvent,
  DocumentEvents,
  StoreName,
  StoreItem,
  MutableStore,
  StoreChange,
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
  RecordTable,
  LayerTable,
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
  GripMoveParams,
  AddWallParams,
  AddWindowParams,
  AddDoorParams,
  AddLevelParams,
  UpdateLevelParams,
  RemoveLevelParams,
  AddLayerParams,
  AddMaterialParams,
  AddTypeParams,
} from './commands/index.js';
export {
  paramsSchema,
  CommandRegistry,
  CommandBus,
  AddLineCommand,
  MoveCommand,
  EraseCommand,
  GripMoveCommand,
  registerBuiltinCommands,
  AddWallCommand,
  AddWindowCommand,
  AddDoorCommand,
  registerArchitectureCommands,
  AddLevelCommand,
  UpdateLevelCommand,
  RemoveLevelCommand,
  AddLayerCommand,
  AddMaterialCommand,
  AddTypeCommand,
  registerDocumentStoreCommands,
  asPoint,
  asIdArray,
  asId,
  asNumber,
  asPositive,
  S,
} from './commands/index.js';

// ── LLM projections (Layer 3) ──
export type { ToolDefinition, DescribeDocumentOptions } from './llm/index.js';
export { toolDefinitions, toolNameFromCommand, commandNameFromTool, describeDocument } from './llm/index.js';

// ── engine systems (Layer 3) ──
export type { SelectionEvents } from './selection/index.js';
export { SelectionSet } from './selection/index.js';
export { SnapEngine } from './snapping/index.js';
export { MeasurementService, geometryLength, geometryArea } from './measurements/index.js';
export type { WallQuantity, MaterialQuantity, QuantityReport } from './measurements/index.js';
export { computeQuantities } from './measurements/index.js';
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

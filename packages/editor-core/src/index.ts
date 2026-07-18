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
  TextShape,
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
  pointOnCircle,
  distanceToCircle,
  distanceToArc,
  isAngleInArc,
  distanceToPolyline,
  EMPTY_MESH,
  extrudeQuad,
  extrudePolygon,
  loftPolygon,
  triangulateLoop,
  mergeMeshes,
} from './geometry/index.js';
export type {
  Loop,
  BoundaryWithHoles,
  Interval,
  WallEnd,
  EndCap,
  ArrangementSegment,
  FaceEdge,
  ArrangementFace,
  ArrangementResult,
} from './topology/index.js';
export {
  mergeIntervals,
  subtractIntervals,
  resolveJunction,
  resolveTeeCap,
  arrangeSegments,
  arrangePlan,
  loopSignedArea,
  pointInLoop,
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
  DimDef,
  DimPointsDef,
  DimWallsDef,
  DimWallSide,
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
  CircleEntity,
  createCircleEntity,
  ArcEntity,
  createArcEntity,
  PolylineEntity,
  createPolylineEntity,
  HostedOpeningEntity,
  WallEntity,
  createWallEntity,
  WindowEntity,
  createWindowEntity,
  DoorEntity,
  createDoorEntity,
  SlabEntity,
  createSlabEntity,
  RoofEntity,
  createRoofEntity,
  FinishEntity,
  createFinishEntity,
  StairEntity,
  createStairEntity,
  DimensionEntity,
  createDimensionEntity,
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
  AddCircleParams,
  AddArcParams,
  AddPolylineParams,
  AddWallParams,
  AddWindowParams,
  AddDoorParams,
  AddLevelParams,
  UpdateLevelParams,
  RemoveLevelParams,
  DuplicateLevelParams,
  AddLayerParams,
  UpdateLayerParams,
  RemoveLayerParams,
  AddMaterialParams,
  UpdateMaterialParams,
  RemoveMaterialParams,
  AddTypeParams,
  UpdateTypeParams,
  RemoveTypeParams,
  SetTypeParams,
  AddSlabParams,
  AutoSlabParams,
  AddRoofParams,
  AutoRoofParams,
  AddFinishParams,
  AutoFinishParams,
  AddFloorFinishParams,
  AutoFloorFinishParams,
  AddStairParams,
  AddDimensionParams,
  AutoDimensionParams,
  LogRequestParams,
  RequestKind,
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
  AddCircleCommand,
  AddArcCommand,
  AddPolylineCommand,
  registerPrimitiveCommands,
  AddWallCommand,
  AddWindowCommand,
  AddDoorCommand,
  registerArchitectureCommands,
  AddLevelCommand,
  UpdateLevelCommand,
  RemoveLevelCommand,
  DuplicateLevelCommand,
  AddLayerCommand,
  UpdateLayerCommand,
  RemoveLayerCommand,
  AddMaterialCommand,
  UpdateMaterialCommand,
  RemoveMaterialCommand,
  AddTypeCommand,
  UpdateTypeCommand,
  RemoveTypeCommand,
  SetTypeCommand,
  registerDocumentStoreCommands,
  AddSlabCommand,
  AutoSlabCommand,
  registerSlabCommands,
  AddRoofCommand,
  AutoRoofCommand,
  registerRoofCommands,
  AddFinishCommand,
  AutoFinishCommand,
  AddFloorFinishCommand,
  AutoFloorFinishCommand,
  registerFinishCommands,
  AddStairCommand,
  registerStairCommands,
  AddDimensionCommand,
  AutoDimensionCommand,
  registerDimensionCommands,
  LogRequestCommand,
  REQUEST_KINDS,
  registerRequestCommands,
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
export type {
  WallQuantity,
  SlabQuantity,
  RoofQuantity,
  FinishQuantity,
  StairQuantity,
  MaterialQuantity,
  QuantityReport,
  LayerRefs,
  SpaceInfo,
  OutlineInfo,
} from './measurements/index.js';
export {
  computeQuantities,
  layerQuantity,
  detectSpaces,
  detectOutlines,
  offsetBoundary,
} from './measurements/index.js';
export type { ViewDefinition } from './views/index.js';
export { entitiesInView, isEntityVisible, isEntityInteractive } from './views/index.js';
export type {
  DisplayStyle,
  RenderItem,
  Renderer,
  AssemblyStrip,
  WallAssemblyStrips,
} from './rendering/index.js';
export { buildDisplayList, wallAssemblyStrips } from './rendering/index.js';
export type { InputModifiers, ToolInputEvent, ToolContext, Tool } from './tools/index.js';
export type { DocumentData } from './io/index.js';
export { saveDocument, loadDocument, loadDocumentInto } from './io/index.js';

// ── facade (Layer 4) ──
export type { EditorSessionOptions } from './editor/index.js';
export { EditorSession } from './editor/index.js';

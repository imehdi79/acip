# The Entity Contract

Status: **Decided** · Last updated: 2026-07-11

The keystone contract. Two structural decisions, then the sketch.

## Decision 1: lean base class + optional capability interfaces

A fat `Entity` base with 20 abstract methods would force every entity to answer questions
that don't apply to it (a dimension hosts nothing; a text label has no 3D form). The base
class holds only what is universally true; everything else is a **capability interface**
the concrete class opts into, discovered via type guards.

## Decision 2: entities hold a back-reference to their owning document

A hosted window cannot compute its world position alone — it must resolve its `hostRef`
to an actual wall. Rather than threading a context parameter through every geometry call
forever, the document sets the back-reference when an entity is added (exactly how
AutoCAD's `AcDbEntity` belongs to a database). The rule:

- **Definition methods** (`saveData`, `getBaseGeometry`) work detached from any document.
- **Derived methods** (`getEffectiveGeometry`, placement evaluation) require residency in
  a document.

## The contract sketch

```ts
abstract class Entity {
  readonly id: EntityId;
  abstract readonly type: string; // registry key: 'wall', 'window', 'dim'
  layerId: LayerId;
  typeRef?: TypeId; // WallType etc. from the type catalog

  // ── 2D plan geometry: the source of truth ──
  abstract getBaseGeometry(): Geometry; // from own definition data only
  getEffectiveGeometry(): Geometry; // default = base; a wall overrides it
  // to subtract hosted openings
  abstract getBounds(): BBox; // feeds the R-tree
  abstract getSnapPoints(filter?: SnapKind[]): SnapPoint[];
  abstract hitTest(pt: Point, tolerance: number): boolean;
  abstract transform(m: Matrix3, tx: Transaction): void;
  abstract clone(): Entity;

  // ── persistence: plain data in/out, paired with the registry factory ──
  abstract saveData(): EntityData; // JSON-safe, versioned
  abstract loadData(data: EntityData): void;
}

// ── capabilities: implemented selectively ──
interface IHost {
  getAnchors(): Anchor[];
} // wall → centerline, faces
interface IHosted {
  hostRef: RelationRef; // window → its wall
  evalPlacement(anchor: Anchor): Placement;
}
interface ILevelAware {
  baseLevelId: LevelId;
  vertical: { height: number } | { topLevelId: LevelId };
}
interface IMeshable {
  toMesh(detail: MeshDetail): Mesh3D;
} // 2.5D derivation
```

## Key semantics

- **`getBaseGeometry` vs `getEffectiveGeometry` is the window-on-wall design**: base is
  what was drawn; effective is after relations have their say (openings subtracted). The
  estimator reads _effective_; the wall's own editing grips use _base_.
- **The `saveData()` invariant**: anything not in `saveData()` is derived and must be
  recomputable. This single invariant powers snapshot undo, serialization, IFC export,
  and future collaboration. Never cache non-recomputable state outside it.
- **Registration** pairs a factory with a data schema; the schema validates `loadData`,
  documents the file format, and is the anchor for future IFC/DXF mapping:

```ts
entityRegistry.register({
  type: 'wall',
  create: () => new WallEntity(),
  schema: WallDataSchema,
});
```

- Entities do **not** emit events themselves; change notification is the transaction's
  job (batched per commit). See [command-transaction.md](command-transaction.md).

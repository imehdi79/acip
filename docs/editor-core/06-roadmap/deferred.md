# Roadmap — Deferred Decisions & Open Questions

Last updated: 2026-07-11

## Deferred (intentionally postponed; the design leaves a slot)

| Topic | Status | Notes |
| --- | --- | --- |
| **editor-server** (persistence, collaboration) | Deferred by user decision — "we talk about editor server later" | The transaction **commit record stream is the future sync protocol**; core design already accommodates it. See [command-transaction.md](../03-contracts/command-transaction.md). |
| **IFC import/export** | Confirmed coming (user: yes) | Massive spec; `io/` + entity data schemas are the mapping anchors. Design `io/` knowing IFC arrives. |
| **Xrefs / underlays** (AutoCAD-style external attachments) | Deferred, not rejected | Touches io + rendering + document at once; design when those exist. |
| **3D editing** | Deferred (v1: 3D is read-only) | See [2.5D strategy](../04-systems/2-5d-strategy.md). |
| **Sections / elevations** | Deferred | Land as `ViewDefinition` with a cut plane. |
| **Roofs / freeform surfaces** | Deferred | Start as extrusions with slope parameter; OpenCascade-via-WASM as an island if ever truly needed. |
| **Parametric constraint solver** | Maybe never | Host relations (one-directional DAG) deliberately are NOT this. See [relations](../04-systems/relations.md). |
| **`editor-sdk` package** | Build when first external package lands | Until then `editor-core/src/index.ts` is the SDK contract. |

## Open questions

1. **Which AI agent first?** Drives which core APIs must be excellent earliest. See
   [ai-agents.md](../05-packages/ai-agents.md).

## Implementation status

**Scaffold landed 2026-07-11.** All four layers exist in `packages/editor-core/src`
with the keystone contracts implemented: Entity base + capability interfaces,
snapshot-based Transaction/CommitRecord/HistoryStack, CommandBus (nested dispatch
joins the parent transaction), RelationGraph (cycle-checked, cascade on erase),
registries, EditorSession facade, native JSON io, and reference implementations
(LineEntity; LINE.ADD / ENTITY.MOVE / ENTITY.ERASE). Verified by
`nx run editor-core:test` (bun test) and `nx run editor-core:typecheck`.

Known placeholders: NaiveSpatialIndex (linear scan behind the SpatialIndex
interface — swap for R-tree later), offset/fillet math, 2D boolean topology,
annotations/blocks entities, and document-level stores (layers/levels/materials/
types) are not yet transactional.

**Semantic slice landed 2026-07-11.** WallEntity (IHost + ILevelAware +
IMeshable: baseline + thickness + height, axis/face anchors, solid spans via
`topology/intervals`, extrusion with opening bands) and WindowEntity (IHosted +
IOpeningCutter + IMeshable: placement derived from host and `t`, plan symbol,
glazing pane mesh; ENTITY.MOVE projects onto the wall axis). Commands WALL.ADD /
WINDOW.ADD; recompute is pull-based lazy evaluation (see
[relations](../04-systems/relations.md) implementation notes). web-editor has
Wall/Window tools and region fill. 25 tests cover the arc, including
wall-carries-window, cascade + single-undo restore, and mesh opening bands.

**Direct-manipulation arc landed 2026-07-11.** IGrippable capability
(GripPoint + moveGrip) on Line/Wall/hosted openings, GRIP.MOVE command,
transformGeometry helper, HostedOpeningEntity base class (shared by
WindowEntity and the new DoorEntity — sill 0, leaf + swing-arc plan symbol,
DOOR.ADD). web-editor SelectTool now does drag-move with dashed ghost preview,
grip dragging (stretch a wall and its openings follow parametrically),
window (L→R, contained) / crossing (R→L, touching) box selection, and a Door
tool. 32 tests.

**Transactional stores + levels arc landed 2026-07-11.** Document stores
(layers, levels, materials, types) now share a MutableStore/RecordTable
abstraction and are mutated through the transaction (`storeAdd`/`storeUpdate`/
`storeRemove`, snapshot-based like entities; `CommitRecord.changes.stores`).
Commands: LEVEL.ADD / LEVEL.UPDATE / LEVEL.REMOVE (blocked while in use) /
LAYER.ADD — all undoable. A level's elevation change marks its entities dirty,
so walls' 3D moves with the datum. web-editor: level picker in the status bar,
add-level form in the panel, walls created on the active level, per-level plan
filtering (unassigned entities show on every level). 40 tests.

Next candidates, in rough order: quantities panel (net areas / per-material
volumes from assembly layers — the estimator seed), wall joins/corner cleanup,
more drafting primitives (arc, circle, polyline entities), copy-floor-to-floor.

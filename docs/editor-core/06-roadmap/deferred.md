# Roadmap — Deferred Decisions & Open Questions

Last updated: 2026-07-17

## Deferred (intentionally postponed; the design leaves a slot)

| Topic | Status | Notes |
| --- | --- | --- |
| **editor-server** (persistence, collaboration) | Deferred by user decision — "we talk about editor server later" | The transaction **commit record stream is the future sync protocol**; core design already accommodates it. See [command-transaction.md](../03-contracts/command-transaction.md). |
| **IFC import/export** | Confirmed coming (user: yes) | Massive spec; `io/` + entity data schemas are the mapping anchors. Design `io/` knowing IFC arrives. |
| **Xrefs / underlays** (AutoCAD-style external attachments) | Deferred, not rejected | Touches io + rendering + document at once; design when those exist. |
| **3D editing** | Deferred (v1: 3D is read-only) | See [2.5D strategy](../04-systems/2-5d-strategy.md). |
| **Sections / elevations** | Deferred | Land as `ViewDefinition` with a cut plane. |
| **Roofs / freeform surfaces** | V1 mono-pitch shipped 2026-07-17 (see [roofs.md](../04-systems/roofs.md)); gable/hip/freeform still deferred | Gable = footprint split by a ridge half-plane; hips = straight skeleton; OpenCascade-via-WASM as an island if freeform is ever truly needed. |
| **Stairs** | Deferred by user decision (2026-07-17) — "we want to do it later" | The design slot is ready: stairs are cross-level relations ([levels-and-views.md](../04-systems/levels-and-views.md)); the `{topLevelId}` variant of `ILevelAware` is typed but unused; a parametric run (position, direction, width, base/top level → derived risers/treads) rides existing machinery. |
| **Wall-top trimming under sloped roofs** | Deferred with stairs (2026-07-17) | Walls under a mono-pitch roof keep flat tops; the wedge to the roof underside is unfilled ([roofs.md](../04-systems/roofs.md)). Wants roof-aware wall tops / `topLevelId` — same vertical machinery as stairs, do them together. |
| **Parametric constraint solver** | Maybe never | Host relations (one-directional DAG) deliberately are NOT this. See [relations](../04-systems/relations.md). |
| **`editor-sdk` package** | Still deferred — first external package (agent-drafter, 2026-07-12) consumes `editor-core/src/index.ts` directly | Split into a real package when a second consumer or versioning pain appears. |

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

**Quantities arc landed 2026-07-11 — the estimator seed.** `measurements/
quantities.ts`: `computeQuantities(doc)` produces wall quantities (length, net
face area, net volume — openings deducted), per-material volumes split across
type-catalog assembly layers proportional to thickness, and window/door counts.
Commands MATERIAL.ADD / TYPE.ADD (material refs validated); WALL.ADD takes
`typeId` (thickness then derives from the assembly). web-editor seeds a demo
catalog (block/insulation/plaster, "Block 300") through the bus then clears
history, new walls use it, and a live Quantities panel updates per commit.
45 tests. `packages/estimator` will consume this and add measurement rules +
cost rates.

**Wall joins V1 landed 2026-07-12.** Derived (never stored) corner cleanup:
`topology/junctions.ts` wheel algorithm over pure `WallEnd` descriptors —
sort by angle, intersect angle-adjacent faces once so neighbors share corners
exactly; miter-limit clamp and parallel/flush fallbacks. Integration is a
single seam (`WallEntity.spanQuadJoined` swaps cap corners into terminal
span quads); plan, mesh, and bounds follow for free. Quantities stay
centerline-based. See [wall-joins.md](../04-systems/wall-joins.md) for
decisions and V1 limitations. 55 tests. V2 = T-junctions.

**Wall joins V2 (T-junctions) landed 2026-07-12.** A wall end touching
another wall's body butts against its near face (`resolveTeeCap`, pure);
detection is endpoint-driven, wheel wins over tee, nearest host wins.
Discovered invariant: wall bounds must include the baseline, because join
discovery goes through the spatial index and must not depend on the join's
own output — recorded in [wall-joins.md](../04-systems/wall-joins.md).
64 tests.

**First AI agent landed 2026-07-12 — `@acip/agent-drafter` (NL → commands).**
Core grew the `llm/` projections (`toolDefinitions`: registry → Anthropic-shape
tool catalog, dot⇄underscore name mapping; `describeDocument`: catalogs +
saveData envelopes + relations + quantity totals), `describe()` schemas +
descriptions on all 13 commands (S builders in `commands/schema.ts`), and
history groups (`beginGroup`/`endGroup`/`runGrouped`) so a whole agent run is
one Ctrl+Z. The agent package proves the plugin seam: depends only on the SDK
barrel, injectable `LlmClient` (scripted fake in tests, fetch-based
`AnthropicClient` for production), validation errors feed back as `is_error`
tool results for self-correction. Workspaces now include `packages/agents/*`.
See [ai-agents.md](../05-packages/ai-agents.md). 72 core + 3 agent tests.

**Drafter wired into web-editor 2026-07-12.** Prompt row under the command
line (NL face of the same bus), key in localStorage with the
browser-direct-access header, live per-command log via `onDispatch`, busy
state, single-undo runs. See [web-editor 04-agent.md](../../web-editor/04-agent.md).

**Save/open landed 2026-07-12.** Core: `loadDocumentInto` (in-place),
`DrawingDocument._reset`/`_emitLoad` (change event kind 'load'),
`EditorSession.save/open/newDocument` — open replaces content inside the
same doc instance so every reference stays valid. web-editor: New/Open/Save
in the top bar, `.acip.json` download/upload, debounced localStorage
autosave restored before catalog seeding. 76 tests.

**Layers completed 2026-07-12.** Layer gains `color` (ByLayer stroke);
LAYER.UPDATE (name/visible/locked/color) and LAYER.REMOVE (blocked for
default or in-use); WALL.ADD takes layerId. One pair of core predicates —
`isEntityVisible` (render, snap, 3D) and `isEntityInteractive` (pick, box
select, hosted placement; locked = visible + snappable but untouchable) —
is THE rule; every read path routes through it, so future entity types
inherit correct layer behavior. web-editor: active layer (new entities land
on it), panel rows with color swatch / eye / lock / delete. 81 tests.

**Drafting primitives landed 2026-07-12.** Circle/Arc/Polyline entities
(grips: circle center+quadrants, arc center+endpoints, polyline vertices;
snap: center/quadrant added to SnapKind), curve math in geometry/curves
(distanceToCircle/Arc/Polyline, isAngleInArc with wrap-around),
CIRCLE.ADD / ARC.ADD / POLYLINE.ADD (all with layerId + describe()
schemas — the agent gains them automatically). web-editor tools: circle
(2-click, live ghost), arc (center/start/end, CCW, ghost), polyline
(chained clicks, Enter finishes, click-first-vertex closes, one dispatch
= one undo). Renderer/measure needed zero changes — the Geometry union
and layer predicates already covered every kind. 89 tests.

**Copy floor to floor landed 2026-07-12.** LEVEL.DUPLICATE clones every
level-aware entity onto a new level and re-attaches cloned hosted openings
(windows/doors keep parametric placements) — one command, one transaction,
one undo. web-editor: copy button per level row (+3 m default). Nested
hosting (hosted entities hosting others) is not traversed — revisit when it
exists. 92 tests.

**Estimator package landed 2026-07-12 — the third tenant of the plugin
seam.** `@acip/estimator`: takeoff facts → pluggable measurement rules
(small-opening threshold, waste factor) → assembly split → rate tables
(data) → BOQ with total and missing-rate flags; `Estimator` class recomputes
per commit (live price ticking). Core grew exactly one field:
`Material.costCode`. web-editor: Cost section with demo EUR rates.
See [estimator.md](../05-packages/estimator.md). 92 core + 6 agent +
6 estimator tests.

**Spaces / room detection landed 2026-07-17.** Derived, never stored — the
wall-joins pattern at room scale. `topology/arrangement.ts`: planar
arrangement of wall baselines (tee snapping at ANY parameter along the host
with a `halfWidth` allowance for face-flush walls, proper X-crossing splits,
node clustering, half-edge leftmost-turn face extraction, detached islands
as holes). `measurements/spaces.ts`: `detectSpaces(doc, levelId)` free
function (no cache on the document — re-affirmed) reporting per room a
**gross** (centerline) and **net** (inner-face, assembly thickness deducted)
boundary + areas, boundary wall ids, and an interior label point.
`describeDocument()` gains a `spaces` section so agents address rooms
("the 14 m² room on L1") instead of reasoning over wall envelopes.
web-editor plan views fill rooms and label net areas live per commit.
See [spaces.md](../04-systems/spaces.md). 107 core tests.

**Dimensions landed 2026-07-17.** First annotation entity, with the
two-sided wall rule: a dimension binds to `axis`/`face+`/`face-` of walls
(spaces.md side convention), so inner chains measure clear widths and outer
chains measure overall extents. The entity stores references, never the
value — a face-bound dimension re-measures when a wall moves or its assembly
thickness changes; erased walls leave it stale (empty render), not broken.
DIM.ADD (points or walls mode) + DIM.AUTO (regenerates: inner clear widths
per detected space from net boundaries, outer extents from wall bounds;
returns `{removed, created}`). The `Geometry` union gained `TextShape`
(anchor/text/height/rotation — core never measures fonts); web-editor draws
text screen-space, Y-flip safe. Human faces: Dimension palette tool
(3-click DIMLINEAR flow with live ghost), `DIM`/`DIMAUTO` command-line
keywords, live length readout on the rubber band while drawing. See
[dimensions.md](../04-systems/dimensions.md). 115 core tests.

**Slabs landed 2026-07-17.** First area entity: closed polygon footprint +
level + assembly build-up; top face flush with the level elevation, body
extrudes DOWN by the assembly thickness (a storey's slab underside is the
storey below's ceiling). `geometry/mesh` gained the promised triangulation:
`triangulateLoop` (ear clipping, concave-safe) + `extrudePolygon`.
SLAB.ADD (footprint) and SLAB.AUTO (floors every detected room from its NET
boundary; regenerates like DIM.AUTO; returns `{removed, created,
totalArea}`) — named SLAB.AUTO, not SLAB.FROM_SPACES, because command names
must stay underscore-free for the lossless dot⇄underscore tool-name mapping.
Quantities gained slab area/volume + the shared assembly split; the
estimator gained `computeSlabTakeoff` and multi-trade BOQ lines (typed slabs
split per cost code, untyped fall back to `slab-volume`). web-editor: Slab
palette tool (vertex clicking), `SLAB`/`SLABAUTO` keywords, seeded
"Slab 200 (15+5)" type + EUR rates; 3D shows slabs through IMeshable
untouched. See [slabs.md](../04-systems/slabs.md). 123 core + 7 estimator
tests.

**Roofs V1 landed 2026-07-17.** Mono-pitch (skillion) roofs — deliberately:
the surface is a single plane so ear-clipped triangulation is exact for any
simple footprint; gable/hip need ridge splitting and stay deferred rather
than ship approximate geometry. RoofEntity: footprint + slope (degrees) +
fall direction + `eavesHeight` above its level; thickness (vertical) from
the RoofType assembly. `geometry/mesh` gained `loftPolygon` (per-vertex
heights; `extrudePolygon` is now its constant case). `arrangePlan` exposes
the building **outlines** (the outer contours space detection previously
discarded), `detectOutlines` derives them per level, and the shared
`offsetBoundary` helper (extracted from net-room construction) pushes them
out to eaves lines. ROOF.ADD + ROOF.AUTO (footprint = outer faces +
overhang, eaves on the tallest wall, fall across the narrow axis,
regenerates; detached buildings each get a roof). Quantities/digest gained
roof slope area + volume; the estimator its third trade (`roof-structure`/
`roofing`, generic `roof-volume`). web-editor: `ROOFAUTO` keyword, seeded
"Roof 250 (20+5)" + rates. Known gap: walls under a sloped roof keep flat
tops (wedge unfilled) — see [roofs.md](../04-systems/roofs.md).
132 core + 8 estimator tests.

**Catalog editing landed 2026-07-17.** MATERIAL.UPDATE / MATERIAL.REMOVE,
TYPE.UPDATE / TYPE.REMOVE (removes blocked while referenced, mirroring
LEVEL/LAYER guards), and ENTITY.SETTYPE — the value-engineering primitive:
retype entities to a different assembly (targetType validated; omit typeId
to clear back to local props). Discovered and fixed: store-invalidated
entities (level/type changes) never had their own spatial-index bounds
refreshed — invisible for levels (elevation is 3D-only) but wrong for type
thickness; `_emitChange` now refreshes them alongside relation-graph
dependents. web-editor: Materials/Types catalog section in the panel
(inline editing, commit-on-blur, one transaction per edit) and an Assembly
dropdown on the selection. The estimator test proves the loop: thicken a
type's block layer → total rises; clear a wall's type → generic unpriced
line; re-code a material → the BOQ line moves. 139 core + 9 estimator
tests.

**Unit-aware layer pricing landed 2026-07-18.** Assembly layers are measured
in each material's own unit, not always volume: `layerQuantity` (one pure
helper in `measurements/`, shared by core quantities and the estimator BOQ so
Materials and Cost panels agree) maps m³→thickness-proportional volume share,
m²→reference area (face/plan/slope, thickness-independent — a 2 mm membrane
priced by area), m→length (wall length or slab/roof `getPerimeter()`),
count→area ÷ `Material.coverage` (the "never model individual tiles" rule
cashed in: 480 tiles from area and tile size). Openings deduct from face area
and volume alike under the same `deducts` policy. `Material` grew `coverage`
(rides save/load); `MaterialUnit` was already typed. `MaterialQuantity.volume`
became `.quantity` (unit-aware). web-editor: per-material unit selector +
coverage field (shown for count), Materials panel shows the right unit. The
estimator test prices a membrane (m²) and tiles (count) per unit.
145 core + 10 estimator tests.

**Surface finishes landed 2026-07-18.** The instance-level half of
materials-and-types.md: `FinishEntity` (IHosted) applies a material to a wall
face, hosted on the `face+`/`face-` anchor the way a window hosts on the axis
— it follows the wall and cascades with it. `getNetArea()` is the band
`[t0,t1]×[sill,top]` minus overlapping openings (pure interval intersection);
it prices through the same unit-aware `layerQuantity` (tiles by count, paint
by area). `detectSpaces` now exposes `boundaryFaces {wallId, side}` (the
room-facing face, from edge-vs-baseline direction), and `FINISH.AUTO` tiles
every room's walls in one dispatch (shared walls finished both sides,
regenerates). `MATERIAL.REMOVE` guards finishes too; quantities/digest gained
`finishArea`; the estimator its fourth trade (`computeFinishTakeoff`, generic
`finish-area` fallback). web-editor: dashed finish bands along the wall face,
`FINISHAUTO` keyword, seeded "Wall tile" (count) + rate. See
[finishes.md](../04-systems/finishes.md).

**Floor/ceiling finishes landed 2026-07-18.** `FinishEntity` generalized to
host on a slab (footprint) as well as a wall (band) — one entity, branches on
host type, so the estimator/quantities pricing paths needed zero changes. Slab
finish covers the whole footprint (`top` = floor, `bottom` = ceiling); the
slab need not be an `IHost` (the finish reads it directly, the relation graph
is host-agnostic) and it cascades on slab erase. `FLOORFINISH.ADD {slabId,
materialId, surface?}` + `FLOORFINISH.AUTO` (one finish per slab on the level;
each AUTO regenerates only its own host kind so wall and floor macros never
collide). web-editor: `FLOORAUTO` keyword, seeded "Floor tile" (m²) + rate.
154 core + 12 estimator tests.

Next candidates: finishes on bare room polygons (no slab required), stairs
(cross-level relations; the `{topLevelId}` variant of ILevelAware is waiting),
gable roofs (ridge half-plane split over the shipped mono-pitch), wall-top
trimming to the roof underside, crossing wall joins, the auto-dimension agent,
cost-optimization agent (ENTITY.SETTYPE gave it its action primitive),
editor-server (persistence/collab/agent host).

# acip — Project Summary & Timeline

Last updated: 2026-07-12 · Companion to [docs/editor-core](../editor-core/README.md)
(architecture source of truth) and [docs/web-editor](../web-editor/README.md)
(app-layer decisions). This file is the narrative: what we are building and how
it got here, arc by arc.

## What exactly are we building

**A web-based, cost-aware building modeler with AI agents as first-class
citizens.** In one formula:

> **AutoCAD + Revit + BIM, driven equally by humans and LLM agents.**

Broken into its four identities:

1. **AutoCAD** — 2D drafting precision: lines, circles, arcs, polylines,
   snapping (endpoint/midpoint/center/quadrant), grips, layers with
   visibility/lock/color, a command line, window/crossing selection.
2. **Revit** — a semantic building model, not dumb geometry: walls that host
   windows and doors parametrically (drag a wall, its openings follow), levels
   (floors) as datums, wall types with material assembly layers, automatic
   wall joins (L, star, and T junctions), derived read-only 3D.
3. **BIM** — the data is the product: materials, type catalogs, live quantity
   takeoff (net areas/volumes with openings deducted), and a bill of
   quantities priced from rate tables — **the price ticks while you drag a
   wall**. Cost-awareness is the app's reason to exist.
4. **AI agents** — every mutation goes through one command bus whose command
   schemas double as LLM tool definitions. The first agent (`@acip/agent-drafter`)
   already draws from a sentence: type *"draw a 6×4 m room with a door"* and
   watch it appear, undoable with a single Ctrl+Z.

### The five golden rules that make it hold together

1. **The core is headless** — no DOM, no React, no canvas in `editor-core`;
   it runs in a browser, Web Worker, or server unchanged.
2. **The command bus is the only mutation path** — humans, tools, and agents
   all dispatch commands; one registration yields validation + command-line
   parsing + an agent tool.
3. **The 2D plan is the single source of truth** — 3D is derived, read-only
   output (2.5D by design).
4. **Anything not in `saveData()` is derived** and recomputable — powers
   snapshot undo, serialization, autosave, and the future collaboration
   protocol (the commit-record stream).
5. **Extension happens through registries** — entity types, commands, tools,
   snap providers, measurement rules; external packages plug in without core
   knowing they exist.

### The monorepo today

| Package / app | Role | Proof it works |
| --- | --- | --- |
| `packages/editor-core` | The headless 4-layer CAD/BIM engine and (for now) the SDK contract via its curated `index.ts` | 92 tests |
| `packages/agents/drafter` | First AI agent: NL → commands via injectable LLM client (Anthropic Messages, fetch-based) | 6 tests |
| `packages/estimator` | Quantity takeoff → measurement rules (policy) → rate tables (data) → live BOQ | 6 tests |
| `apps/web-editor` | React + Vite shell: Canvas2D plan viewport (immediate mode), lazy three.js 3D, tools, panels, command line, agent prompt row | typecheck + build |
| `apps/editor-server` | Reserved: persistence, collaboration, agent host (deferred by decision) | — |

The two external packages (drafter, estimator) are the architecture's proof:
both consume core **only through the SDK barrel** — one acts through the bus,
one observes through events and read services. Core contains zero knowledge of
either.

## Timeline

Everything below happened over three days (2026-07-10 → 2026-07-12), each arc
shipped with docs-first commits, tests, and a green build.

### 2026-07-10 — Seed
- Nx monorepo scaffolded (bun, apps/web-editor + editor-server, packages).

### 2026-07-11 — Architecture and engine
- **React Router** home/admin pages (the original small request that started
  the conversation).
- **Design discussions** → decision: an advanced CAD app = AutoCAD + Revit +
  BIM with agents as separate packages later. Entity contract,
  command/transaction interfaces, host relations, multi-floor, 2.5D, material
  layers, estimator — all decided *before code*.
- **docs/editor-core written as source of truth** (14 files) so any session —
  human or LLM — starts from the same decisions. `@ecore` renamed to
  `@acip/editor-core`.
- **Engine scaffold**: 4 strict layers (common+geometry/topology → entities/
  document/relations/registries → commands/systems → editor facade),
  snapshot-based transactions + CommitRecord + undo/redo, command bus,
  cycle-checked relation graph, EditorSession facade, LineEntity as reference.
- **web-editor shell**: Canvas2D immediate-mode viewport (Konva and
  react-three-fiber evaluated and rejected — mirror-tree sync), imperative
  viewport island (React never in the pointer-move path), command line,
  panels, status bar; three.js 3D lazy-loaded.
- **Semantic slice**: WallEntity (baseline+thickness, axis/face anchors, solid
  spans) hosting WindowEntity parametrically; pull-based lazy recompute.
- **Direct manipulation**: grips, GRIP.MOVE, drag-move with ghost preview,
  window/crossing box selection, DoorEntity with swing arc.
- **Transactional stores + levels**: layers/levels/materials/types mutate
  through transactions (undoable); multi-floor UI with per-level plan
  filtering; level elevation moves its walls in 3D.

### 2026-07-12 — BIM data, joins, agents, and the full roadmap
- **Quantities (estimator seed)**: `computeQuantities` — net face areas,
  net volumes, per-material splits from assembly layers; MATERIAL.ADD /
  TYPE.ADD; live Quantities panel.
- **Wall joins V1**: derived-not-stored corner cleanup — junction wheel
  algorithm over pure `WallEnd` descriptors; miter-limit and parallel
  fallbacks; one integration seam in WallEntity.
- **Wall joins V2 (T-junctions)**: tee ends butt against the host's near
  face. Discovered invariant: *anything used to discover a derived
  relationship must be independent of that relationship's result* (wall
  bounds now always include the baseline).
- **LLM projections + first agent**: every command gained `describe()`
  schemas; `toolDefinitions()` turns the registry into an agent tool catalog;
  `describeDocument()` digests the model for an LLM; history groups make an
  agent run one Ctrl+Z. `@acip/agent-drafter` ships with a scripted-fake test
  suite and a fetch-based Anthropic client.
- **Tabler icons** replace unicode glyphs (stroke style matches the canvas
  linework; literal wall/window/door glyphs).
- **Agent prompt row in the app**: type a sentence under the command line,
  watch commands stream into the log and walls appear live; API key in
  localStorage (browser-direct, personal-key only).
- **Save/Open**: in-place document replacement (`session.open`), `.acip.json`
  download/upload, debounced localStorage autosave.
- **Layers completed**: ByLayer color, visibility/lock enforced by one
  predicate pair across render/snap/pick/3D, active layer, full panel UI.
- **Drafting primitives**: Circle, Arc, Polyline entities + commands + tools
  (ghost previews; the agent gained the commands automatically).
- **Copy floor to floor**: LEVEL.DUPLICATE clones a level's entities and
  re-attaches hosted openings — one transaction, one undo.
- **Estimator package**: facts (takeoff) → policy (pluggable measurement
  rules: small-opening threshold, waste factor) → data (rate tables) →
  live BOQ with total and missing-rate flags; Cost panel with demo EUR rates.
  Core grew exactly one field for all of this: `Material.costCode`.

### 2026-07-17 — Spaces (room detection)

- **Spaces / room detection**: rooms are detected automatically from walls —
  derived, never stored (the wall-joins pattern at room scale). A planar
  arrangement of baselines (`topology/arrangement.ts`) splits walls at every
  touch point: corners, tees at *any* parameter along the host (face-flush
  walls connect via a `halfWidth` allowance), and X crossings; faces of the
  graph are the rooms, detached islands become holes. `detectSpaces(doc,
  levelId)` reports **gross** (centerline) and **net** (inner-face — each
  wall's assembly thickness deducted) boundaries and areas. Draw four walls
  and a partition — two rooms appear; erase the partition — they merge.
  Plan views fill rooms and label net areas live; `describeDocument()` gains
  a `spaces` section so agents address rooms ("the 14 m² room on L1") for a
  few tokens each. See [spaces.md](../editor-core/04-systems/spaces.md).
- **Dimensions**: first annotation entity, with the two-sided wall rule —
  bind to `axis`/`face+`/`face-`, so one side of a wall measures inner clear
  widths and the other outer overall extents. References are stored, values
  always derived: move a wall or change its assembly thickness and the
  dimension re-measures. `DIM.AUTO` regenerates a level's dimensions from
  detected spaces (inner) and wall bounds (outer) in one undoable
  transaction, returning `{removed, created}` — one intent-level agent call.
  `TextShape` joins the Geometry union (text is geometry; drawing it is the
  renderer's job). In the app: a Dimension palette tool (DIMLINEAR-style
  3-click flow with live entity-geometry ghost), `DIM`/`DIMAUTO` command-line
  keywords, and a live length readout on the rubber band while drawing.
  See [dimensions.md](../editor-core/04-systems/dimensions.md).
- **Slabs**: first area entity — closed polygon footprint + level + assembly
  build-up; the top face sits at the level elevation and extrudes down by
  the assembly thickness. `SLAB.AUTO` floors every detected room from its
  net boundary in one dispatch (regenerates like DIM.AUTO). Ear-clipping
  triangulation + `extrudePolygon` fill the promised `geometry/mesh` slot,
  so concave rooms extrude correctly and slabs appear in 3D untouched.
  The BOQ goes multi-trade: concrete/screed lines from slab assemblies join
  the wall trades in the live Cost panel. In the app: Slab palette tool,
  `SLAB`/`SLABAUTO` keywords, seeded "Slab 200 (15+5)" type + rates.
  See [slabs.md](../editor-core/04-systems/slabs.md).
- **Roofs (mono-pitch V1)**: footprint + slope (degrees) + fall direction,
  eaves at `level + eavesHeight`; the surface is a single plane so the
  triangulation is exact — gable/hip deferred rather than shipped
  approximate. `ROOF.AUTO` roofs the whole building in one dispatch: the
  arrangement's outer contour (now exposed as `detectOutlines`) pushed out
  to the wall faces plus an overhang, eaves on the tallest wall, fall across
  the narrow axis; detached buildings each get their own roof.
  `loftPolygon` (per-vertex heights) joins `geometry/mesh`. Roofing becomes
  the third trade in the live BOQ. In the app: `ROOFAUTO` keyword, seeded
  "Roof 250 (20+5)" + rates. See [roofs.md](../editor-core/04-systems/roofs.md).
- **Catalog editing**: the assembly-layer promise made actionable —
  `TYPE.UPDATE` re-thickens and re-prices every instance live (change block
  20→25 cm and watch walls thicken and the BOQ jump), `ENTITY.SETTYPE`
  retypes a selection (the value-engineering primitive agents need),
  `MATERIAL.UPDATE` re-codes rate-table lines; removes are blocked while
  referenced. Fixed along the way: store-driven invalidation (levels,
  types) never refreshed the affected entities' own spatial bounds. In the
  app: an editable Materials/Types catalog section and an Assembly dropdown
  on the selection.

## Where it stands / what's next

154 tests across three packages; all typechecks and builds green. The
architecture has survived its three intended stress tests: a semantic model
(joins/hosting), an acting external package (agent), and an observing external
package (estimator) — none required core rework.

Next candidates (see [roadmap](../editor-core/06-roadmap/deferred.md)):
unit-aware layer pricing (m²/count materials priced by area, not volume
share), stairs (cross-level relations), gable roofs (ridge split over the
shipped mono-pitch), wall-top trimming, crossing wall joins, the
auto-dimension agent, a cost-optimization agent (ENTITY.SETTYPE is its
action primitive), editor-server, IFC import/export.

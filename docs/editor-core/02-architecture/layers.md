# editor-core Internal Layering

Status: **Decided** · Last updated: 2026-07-11

`packages/editor-core/src` is organized in **4 strict layers. Lower layers must never
import from higher ones.** (Enforce later with Nx module-boundary tags.)

```
src/
│                      ── LAYER 0: plumbing ──
├── common/            # typed EventEmitter, id generation, epsilon/tolerance, errors.
│                      # Scoped to plumbing ONLY — named submodules, no junk drawer.
│
│                      ── LAYER 1: pure math (functions + immutable value types) ──
├── geometry/
│   ├── primitives/    # Point, Vector, Matrix3, BBox — immutable value types
│   ├── curves/        # line/arc/circle/ellipse/polyline/spline math
│   ├── intersect/     # central pairwise dispatcher — solves double-dispatch
│   ├── offset/        # offset, fillet, chamfer math
│   └── mesh/          # 2.5D derivation: extrusion, triangulation, opening subtraction
├── topology/          # loops, regions, boundary-with-holes, connectivity graphs
│                      # (feeds hatch boundaries, trim networks, opening subtraction)
│
│                      ── LAYER 2: the document model (class-based) ──
├── entities/
│   ├── base/          # Entity abstract class + capability interfaces (see contracts)
│   ├── primitives/    # LineEntity, ArcEntity, CircleEntity, PolylineEntity…
│   ├── annotations/   # TextEntity, Dimension, Leader, Hatch
│   └── blocks/        # BlockDefinition, BlockReference
├── document/
│   ├── spatial/       # R-tree index, kept in sync via transaction change events
│   ├── history/       # transaction records + undo/redo stack
│   ├── levels/        # Level datums: name, elevation, ordering
│   ├── materials/     # material library: name, 2D hatch, 3D appearance, cost hooks
│   └── types/         # type catalog: WallType with assembly layers, etc.
├── relations/         # host↔attachment DAG: placement params, dirty propagation,
│                      # cascade policies (see 04-systems/relations.md)
├── registry/          # EntityTypeRegistry, CommandRegistry, ToolRegistry —
│                      # THE extension points external packages register into
│
│                      ── LAYER 3: engine systems ──
├── commands/          # command bus: schema'd, validated, transactional
├── tools/             # interactive state machines consuming ABSTRACT input (no DOM)
├── selection/         # hit-testing, window/crossing, selection sets
├── snapping/          # OSNAP providers (endpoint, mid, center, intersection…) —
│                      # provider-based so packages can contribute snap types
├── measurements/      # read-only queries: area, length, volumes, mass properties
├── views/             # ViewDefinition = filter + projection + display settings
│                      # PlanView(level), View3D. Viewports render Views, never raw doc.
├── rendering/         # Renderer INTERFACE + display list + tessellation ONLY;
│                      # Canvas/WebGL implementations live in web-editor
├── io/                # native JSON format, DXF; IFC later — all via the type registry
├── llm/               # LLM projections: command registry → tool defs,
│                      # document → digest. Core never talks to a model itself.
│
│                      ── LAYER 4: facade ──
├── editor/            # EditorSession: wires document + commands + tools + selection.
│                      # What web-editor instantiates; what editor-sdk will re-export.
└── index.ts           # curated exports only — tomorrow's SDK contract
```

## Code style policy

- **Class-based model layer** (entities, document, tools, commands): CAD is the textbook
  OO domain (cf. AutoCAD's AcDbLine/AcDbArc hierarchy). Polymorphic `transform()`,
  `getBounds()`, `getSnapPoints()` etc.
- **Function-based math layer** (geometry, topology): pure/free functions over small
  immutable value types. **Never put math _between_ types as methods**
  (`line.intersectWith(arc)` → N×N double-dispatch trap). Type-pair relationships live in
  `geometry/intersect/`'s dispatcher.

## History: mapping from the original empty folders

The user's original scaffold → where it went and why:

| Original       | Now                       | Why                                                                                                |
| -------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `geometry/`    | `geometry/`               | Kept — correct as-is                                                                               |
| `topology/`    | `topology/`               | Kept — the geometry/topology split is what real kernels do                                         |
| `models/`      | `entities/` + `document/` | Entities are things agents create; the document is infrastructure they operate within              |
| `engins/`      | `editor/`                 | (typo fixed) named for what it is; "engine" attracts everything                                    |
| `computes/`    | `measurements/`           | Algorithms belong in geometry/topology; derived read-only values earn their own folder             |
| `helpers/`     | `common/`                 | Same idea, scoped to plumbing with named submodules                                                |
| `attachments/` | `relations/`              | The user's instinct was host/attachment relationships (window-on-wall) — promoted to a core system |

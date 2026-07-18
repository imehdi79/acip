# Materials, Type Catalog & Finishes

Status: **Decided** · Last updated: 2026-07-18

> **Catalog editing shipped 2026-07-17.** The "change the type → every wall
> updates" promise is now actionable: `MATERIAL.UPDATE` / `MATERIAL.REMOVE`,
> `TYPE.UPDATE` / `TYPE.REMOVE` (removes blocked while referenced), and
> `ENTITY.SETTYPE` (retype instances — targetType must match the entity
> kind; omit `typeId` to fall back to local props). A type change marks
> every referencing entity dirty, so thickness, spatial bounds, geometry,
> and cost re-derive live. Types now target walls, slabs, and roofs alike.
> web-editor: editable Materials/Types panel section (commit on blur, one
> transaction per edit) and an Assembly dropdown on the selection.

User requirement: _"attach tiles — or better, layers — to a wall."_ Two distinct concepts
hide in that sentence; we want both, and they land in different places.

## 1. Assembly layers (type-level)

A wall is a _build-up_: 20cm block + 5cm insulation + 2cm plaster + 1cm tile. That
composition belongs to the **wall type**, not each instance:

- `document/types/` — the **type catalog**: a `WallType` holds ordered layers, each
  layer = material + thickness. Wall instances reference their type via `Entity.typeRef`.
- Change the type → every wall of that type updates (same recompute propagation).
- Yields: total wall thickness, per-layer hatching in plan view, per-material quantities for
  the estimator.

### Per-layer display shipped (2026-07-18)

The "per-layer hatching in plan view" yield is now real, on three surfaces at once:

- **Plan** — `wallAssemblyStrips` (Layer-3 free function in `rendering/`, derived on
  read, never stored) turns a typed wall into per-layer strips plus separation
  lines, outermost layer on the wall's `face+` side, split by the solid spans so
  openings cut through every layer. The web-editor draws separation lines, an
  alternating tint (readable with zero hatch config), and `Material.hatch`
  patterns — `diagonal`, `cross`, `dots`; unknown names fall back to diagonal —
  gated to walls ≥ ~6 px thick on screen (coarse/fine detail, Revit-style). V1
  strips skip junction miters and stop at baseline endpoints (wall-joins.md).
- **3D** — the viewer builds one Three material per document material instead of
  one gray for the whole scene. `Material.appearance.color` wins
  (`MATERIAL.ADD`/`MATERIAL.UPDATE` gained a `color` param that writes it); a
  material without a color gets a stable name-derived tint. Walls/slabs/roofs
  show their outermost assembly layer's material, finishes their own.
- **Catalog panel** — each type shows a build-up swatch (segment width ∝ layer
  thickness, same display colors) and each material a color picker.

Still deferred there: hatch-aware junction miters, per-face 3D materials, and a
section/cutaway mode that exposes the build-up at a cut plane.

### Layer quantities are unit-aware (2026-07-18)

Splitting every layer by volume is wrong for thin or countable materials. Each
layer is measured in its **material's unit** (`layerQuantity`, one pure helper
shared by core quantities and the estimator BOQ so the Materials and Cost
panels never disagree):

- **m³** — a thickness-proportional share of the element's net volume (each
  layer's own solid volume). The classic block/insulation/plaster case.
- **m²** — the element's reference area, _thickness-independent_: a 2 mm
  membrane or a coat of paint is priced by the area it covers, not its sliver
  of volume. Reference area = wall net face area, slab plan area, roof slope
  area.
- **m** — the linear measure (wall length, slab/roof perimeter): DPC, coping,
  edge trim.
- **count** — reference area ÷ `Material.coverage` (m² per unit, e.g. a
  0.3×0.3 tile = 0.09). This is the _"never model individual tiles"_ rule
  cashed in — 480 tiles from an area and a tile size, no tile entities.
  Missing coverage falls back to 1 unit/m².

Openings deduct from **both** the volume and the face area, so an m²/count
finish shrinks around a door exactly as the volume does — and the same
`deducts` policy (small openings ignored) governs both. Thickness stays a
required layer field (it drives the m³ split and the total wall thickness)
even for m²/count layers.

Slab/roof reference lengths come from `getPerimeter()` on the entities; walls
use their centerline length. `Material.coverage` rides save/load like every
other material field — core stores it, the estimator prices it.

## 2. Surface finishes (instance-level)

_"Tile THIS bathroom wall, up to 1.2m height"_ is one wall's business, not the type's.
This is **exactly the [relations](relations.md) machinery again**: a finish entity hosted
on a wall **face** (an anchor from `IHost.getAnchors()`), placement params = extent +
height, participating in recompute:

- stretch the wall → tiled area updates
- add a window → the opening subtracts from the tiled region

**Shipped 2026-07-18** — see [finishes.md](finishes.md). `FinishEntity` hosts on the
wall's `face+`/`face-` anchor; `getNetArea()` is the band `[t0,t1]×[sill,top]` minus
overlapping openings; it references a single material and prices through the same
unit-aware `layerQuantity` (tiles by count, paint by area). `FINISH.AUTO` tiles every
room from `SpaceInfo.boundaryFaces` (the room-facing side of each boundary wall). V1
is rectangular wall-face bands; boundary-with-holes regions and floor finishes are
deferred there.

## Materials are first-class

What gets attached is not a mesh — it is a **material**. The mesh/texture is how a
material _looks in 3D_; the hatch pattern is how it looks _in plan_; the cost-per-m² is
how it looks _to the estimator_.

- `document/materials/` — material library: name, 2D hatch, 3D appearance, measurement
  hooks (unit, cost basis).

## Hard rule: never model individual tiles

Tile _pattern layout_ (grout lines, edge cuts) is a rendering + estimation detail, not
model geometry. Model the **finish region**; the estimator computes tile counts from
area, tile size, and a waste factor. Ten thousand tile entities would kill performance
for zero benefit.

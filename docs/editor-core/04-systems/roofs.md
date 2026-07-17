# Roofs

Status: **Decided** (V1 mono-pitch shipped 2026-07-17; gable/hip deferred)

The roadmap slot said "roofs can start as extrusions with a slope parameter"
— this is that start. A roof is a closed footprint + a slope + a fall
direction, lofted between two rings of per-vertex heights. `ROOF.AUTO` puts
a roof over the whole building in one dispatch, taking its footprint from
the arrangement's outer contour — the same machinery that detects rooms.

## Golden decision 1: V1 is mono-pitch, and that is deliberate

A mono-pitch (skillion) roof surface is a single plane, so the ear-clipped
footprint triangulation is **exact** for any simple footprint — L-shapes
included. Gable and hip roofs have creases: correct meshes need the
footprint split along ridge lines before triangulation, or triangles
spanning the ridge render a false facet. That splitting (half-plane clipping
first, straight skeleton for hips later) is the deferred slot; V1 refuses to
ship approximate geometry.

Slope is stored in **degrees** (0 = flat), fall along a stored `direction`
vector. Height at a point: eaves elevation at the most-downhill footprint
vertex, rising at `tan(slope)` uphill. Thickness is measured **vertically**
(a 15° roof differs from plumb by ~3.5%; documented, revisit with gables).

## Golden decision 2: vertical placement = level + eavesHeight

A roof belongs to the level it covers (`baseLevelId`), with eaves at
`level elevation + eavesHeight` (stored, default 3 — a storey of walls).
`ROOF.AUTO` derives `eavesHeight` from the tallest wall on the level, so the
roof lands on the wall tops without a dedicated "roof level". Assembly
follows the house pattern: a `RoofType` (`targetType: 'roof'`) with layers
wins over the local `thickness` prop.

## Golden decision 3: ROOF.AUTO's footprint is the outer contour + overhang

Space detection already computes the building outline — it is the
arrangement's outer cycle, previously discarded. `arrangePlan` now returns
it alongside the faces, and the same corner-offset math that pulls room
boundaries **in** to inner faces pushes the outline **out** to the eaves
line: each edge offset by its wall's half thickness plus the overhang
(default 0.3 m), corners intersected, jog fallbacks intact. One shared
`offsetBoundary` helper serves both rooms and eaves.

`ROOF.AUTO {levelId?, slope?, overhang?, typeId?}` regenerates like
`DIM.AUTO`/`SLAB.AUTO`: previously auto-created roofs on the level are
replaced; hand-placed roofs are never touched. Fall direction defaults to
across the footprint's narrow axis (the way sheds actually drain). Returns
`{removed, created, planArea}`. Detached buildings each get their own roof
(one outline per connected component).

## Geometry: `loftPolygon`

`geometry/mesh` gains `loftPolygon(points, zBottom[], zTop[])` — triangulated
caps at per-vertex heights plus side quads. `extrudePolygon` is now the
constant-height special case of it. Any future sloped footprint entity
(ramps, gable halves) reuses the loft.

## Integration

- `entities/architecture/roof-entity.ts` — footprint + `slope` + `direction`
  + `eavesHeight`; `ILevelAware`, `IMeshable`, `IGrippable` (vertex grips).
  Plan symbol: the footprint region plus a fall arrow at the centroid.
  `getSlopeArea()` = plan area / cos(slope) — what roofing trades price.
- `commands/roofs.ts` — `ROOF.ADD` (explicit footprint) and `ROOF.AUTO`.
- **Quantities** — per-roof plan/slope areas and volume
  (plan area × vertical thickness), assembly split, `roofSlopeArea` /
  `roofVolume` totals in the report and the LLM digest.
- **Estimator** — `computeRoofTakeoff` feeds the BOQ: typed roofs split per
  cost code, untyped fall back to `roof-volume`.
- **web-editor** — `ROOFAUTO` command-line keyword (active level, seeded
  roof type); the demo catalog seeds "Roof 250 (20+5)" with EUR rates; 3D
  shows the sloped body through `IMeshable` untouched. No palette tool in
  V1 — a hand-drawn roof needs slope/direction input the tool UI doesn't
  have yet; `ROOF.ADD` remains reachable by agents and the command line.

## Known V1 limitations

- **Mono-pitch only** — no ridge, no gable ends, no hips (see decision 1).
- **No wall-top trimming** — walls under a sloped roof keep their flat
  height; the wedge between wall top and roof underside is not filled
  (needs wall `topLevelId`/roof-aware tops — the stairs/section arc).
- **Vertical thickness**, not plumb (documented above).
- **Overhang offsets can self-intersect** on very jagged outlines with
  large overhangs (miter-limit jogs keep it bounded, not pretty).
- **Spikes in the outline** (dangling stub walls) produce eaves notches.

## Deferred

Gable (footprint split by a ridge half-plane, two mono-pitch halves), hip
roofs (straight skeleton), wall-top trimming to the roof underside, plumb
thickness, fascia/gutter edges, roof openings (skylights, chimneys).

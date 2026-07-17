# Surface Finishes

Status: **Decided** (wall-face + floor/ceiling finishes shipped 2026-07-18)

The instance-level half of [materials-and-types.md](materials-and-types.md):
*"tile THIS wall up to 1.2 m"* and *"tile the kitchen floor."* A finish is a
material applied to a surface of a host — a **wall face** (a band) or a
**slab** (its footprint: `top` = floor, `bottom` = ceiling) — authored
content, hosted the way a window is, priced by the unit-aware layer machinery.
`FINISH.AUTO` tiles every wall of a detected room; `FLOORFINISH.AUTO` floors
every slab. One `FinishEntity` serves both: the estimator and quantities read
`getNetArea()` without knowing which host it sits on.

## Golden decision 1: a finish is a hosted entity on a host surface

Finishes reuse the [relations](relations.md) hosting the same way openings do:

- **Wall face** — attach to the wall's `face+` (anchor 1) / `face-` (anchor 2)
  from `WallEntity.getAnchors()`, instead of its axis.
- **Slab** — attach to the slab with anchor 0 (`top`, floor) / 1 (`bottom`,
  ceiling). The slab does not need to be an `IHost`; the finish reads its
  footprint directly and the relation graph is host-agnostic.

`FinishEntity` implements `IHosted` and branches on host type: a wall gives a
band, a slab gives its footprint. Either way it follows its host — stretch the
wall or edit the slab and the area recomputes — and **cascades when the host
is deleted** (the existing `dependentsOf` erase walk, unchanged). No absolute
geometry is stored: band params (`sillHeight`, `topHeight`, `t0`, `t1`) live
on the entity, the host anchor on the relation; slab finishes ignore the band
params.

Like windows and doors, a finish is not itself `ILevelAware` — it inherits its
host's storey implicitly. (The existing hosted-entity plan-view filtering
limitation applies equally; a single fix for all hosted kinds is deferred.)

## Golden decision 2: the finished area is the band minus the openings

The finish covers a rectangle on the face: along the wall `[t0·L, t1·L]`,
vertically `[sillHeight, topHeight]` (topHeight `null` = full wall height,
resolved on read so raising the wall grows the finish). `getNetArea()`
subtracts every opening that overlaps that band — add a window and the tiled
area drops by the overlap, exactly as the vision promised. Pure interval
intersection in both axes; no boundary-with-holes needed for a rectangular
band. Quantities read `getNetArea()`, never the plan geometry (which is a
line).

## Golden decision 3: a finish is a one-layer, instance-level assembly

A finish references a **material directly** (not a type — types are
multi-layer build-ups). Its quantity flows through the *same* `layerQuantity`
helper as assembly layers, so a `count` tile finish yields tile counts, an
`m²` paint finish yields area, `m` a trim length, `m³` a screed volume
(area × the finish's thickness, default 10 mm). The estimator prices it as
one more BOQ trade with zero new pricing code.

## FINISH.AUTO: tile a room from its boundary faces

Space detection already knows each room's boundary walls; it now also exposes
**which side of each wall faces into the room** (`SpaceInfo.boundaryFaces =
{ wallId, side }[]`, derived by comparing each arrangement edge's direction to
the wall's baseline). `FINISH.AUTO {levelId?, materialId, sillHeight?,
topHeight?}` applies a finish to every room-facing face on the level. A wall
between two rooms is finished on both sides — one finish per room. Regenerates
like the other AUTO macros (auto-tagged finishes on the level's walls are
replaced; hand-placed finishes are untouched). Returns `{removed, created,
totalArea}`.

## Integration

- `entities/architecture/finish-entity.ts` — `IHosted`; plan geometry is the
  covered face sub-segment (a line hugging the wall), so it selects and snaps;
  no `IMeshable` in V1 (3D shows the wall, not the tiles). `transform` is a
  no-op — a finish is bound to its wall, not a location.
- `commands/finishes.ts` — `FINISH.ADD {wallId, side, materialId, ...}` +
  `FINISH.AUTO` (walls); `FLOORFINISH.ADD {slabId, materialId, surface?}` +
  `FLOORFINISH.AUTO {levelId?, materialId, surface?}` (slabs, one finish per
  slab; run `SLAB.AUTO` first for a slab per room). Each AUTO regenerates only
  its own kind — the wall macro removes wall-hosted auto finishes, the floor
  macro removes slab-hosted ones of the same surface, so they never collide.
  `MATERIAL.REMOVE` blocks while any finish references the material.
- **Quantities** — per-finish net area + unit-aware material rollup;
  `finishArea` total and a `finishes` list; the LLM digest gains `finishArea`.
- **Estimator** — `computeFinishTakeoff` → BOQ lines through `layerQuantity`;
  typed by the material's unit, generic `finish-area` fallback in m² when the
  material has no cost code.
- **web-editor** — finish bands (walls) and footprint outlines (slabs) drawn
  in a distinct dashed color; `FINISHAUTO` tiles the active level's walls with
  a seeded "Wall tile" (count) material, `FLOORAUTO` floors its slabs with
  "Floor tile" (m²); demo rates price both.

## Known V1 limitations

- **Slab-hosted floors** — a floor finish needs a slab (`SLAB.AUTO` makes one
  per room); there is no finish directly on a bare room polygon.
- **Ceiling = slab underside** — a `bottom` finish is the slab's own
  underside, which reads as the ceiling of the storey below; suspended
  ceilings at an arbitrary height are not modeled.
- **Rectangular wall band** — a wall finish is one axis-aligned band per face;
  sloped tops, cutouts beyond openings, and per-face patterns are not modeled.
- **Slab finishes cover the whole footprint** — floor penetrations (a stair
  shaft) are not subtracted.
- **Single material per finish** — a plaster+paint build-up is two stacked
  finishes, not one layered finish.
- **No 3D** — finishes don't render in the 3D view (no z-fighting risk, no
  textures).
- **No grips** — edit by re-issuing the command or deleting.

## Deferred

Finishes on bare room polygons (no slab); boundary-with-holes finish regions
(non-rectangular, penetrations); suspended ceilings; layered finishes; 3D
finish surfaces; finish grips; per-room finish schedules in the estimator
output.

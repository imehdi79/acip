# Surface Finishes

Status: **Decided** (V1 wall-face finishes shipped 2026-07-18)

The instance-level half of [materials-and-types.md](materials-and-types.md):
*"tile THIS wall up to 1.2 m."* A finish is a material applied to a region of
one wall's face — authored content, hosted on the wall the way a window is,
priced by the unit-aware layer machinery. `FINISH.AUTO` tiles every wall of a
detected room in one dispatch.

## Golden decision 1: a finish is a hosted entity, on a wall FACE

Finishes reuse the [relations](relations.md) hosting the same way openings do,
but attach to the wall's `face+` / `face-` anchor instead of its axis:

- `FinishEntity` implements `IHosted`; `FINISH.ADD` calls `tx.attach(wallId,
  finishId, anchorIndex, {})` where anchorIndex is 1 (`face+`) or 2 (`face-`)
  from `WallEntity.getAnchors()`.
- It follows the wall automatically: stretch the wall and the finished area
  recomputes; **delete the wall and the finish cascades** with its openings
  (the existing `dependentsOf` erase walk).
- No absolute geometry is stored. The finish keeps its band params in its own
  props (`materialId`, `sillHeight`, `topHeight`, `t0`, `t1`, `thickness`);
  the relation stores which face. Same rule as openings: params on the
  entity, anchor on the relation.

Like windows and doors, a finish is not itself `ILevelAware` — it inherits its
host wall's storey implicitly. (The existing hosted-entity plan-view filtering
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
- `commands/finishes.ts` — `FINISH.ADD {wallId, side, materialId, ...}` and
  `FINISH.AUTO`. `MATERIAL.REMOVE` now also blocks while a finish references
  the material (alongside the type-layer guard).
- **Quantities** — per-finish net area + unit-aware material rollup;
  `finishArea` total and a `finishes` list; the LLM digest gains `finishArea`.
- **Estimator** — `computeFinishTakeoff` → BOQ lines through `layerQuantity`;
  typed by the material's unit, generic `finish-area` fallback in m² when the
  material has no cost code.
- **web-editor** — finish bands drawn along the wall face in a distinct
  color; `FINISHAUTO` command-line keyword tiles the active level with a
  seeded "Wall tile" (count) material; demo rates price it per tile.

## Known V1 limitations

- **Wall-face finishes only** — floor/ceiling finishes (on slabs or room
  polygons) are the obvious next step but need a different host; deferred.
- **Rectangular band** — a finish is one axis-aligned band per face; sloped
  tops, cutouts beyond openings, and per-face patterns are not modeled.
- **Single material per finish** — a plaster+paint build-up is two stacked
  finishes, not one layered finish.
- **No 3D** — finishes don't render in the 3D view (no z-fighting risk, no
  tile textures).
- **No grips** — edit by re-issuing `FINISH.ADD` or deleting; the band params
  aren't draggable yet.

## Deferred

Floor/ceiling finishes; boundary-with-holes finish regions (non-rectangular);
layered finishes; 3D finish surfaces; finish grips; per-room finish schedules
in the estimator output.

# Stairs

Status: **Decided** (V1 straight flight shipped 2026-07-18)

levels-and-views.md promised it: _"Stairs and shafts are cross-level relations
— levels are not isolated silos."_ A stair is the first entity whose vertical
extent spans **two levels**, and the first real user of the `{topLevelId}`
variant of `ILevelAware` that was typed on day one and unused ever since.

## Golden decision 1: a stair is parametric — geometry derives from the rise

A `StairEntity` stores only intent: an `origin`, a run `direction`, a `width`,
a `baseLevelId`, and a top given as **either** `{topLevelId}` **or**
`{height}`. Everything visible derives on read:

- **rise** = `topLevel.elevation − baseLevel.elevation` (or the flat height).
- **riser count** = `max(1, ceil(rise / MAX_RISER))` (`MAX_RISER` 0.19 m), so
  the actual riser = `rise / riserCount` always lands under code max.
- **run length** = `riserCount × GOING` (`GOING` 0.28 m tread depth).

Raise the top level and the stair re-treads itself — more risers, longer run —
with no edit. That is the cross-level relation made real: the stair depends on
both level datums, and either one moving invalidates it.

## Golden decision 2: cross-level dirty propagation

The level→entity invalidation that already existed for wall heights
(`baseLevelId`) now also fires on `{topLevelId}`. `DrawingDocument._emitChange`
marks any `ILevelAware` entity dirty when a changed level is its base **or**
its top. `LEVEL.REMOVE` is likewise blocked while a stair references the level
as either base or top — you can't pull a datum out from under a stair.

No new machinery: this rides the same dirty-propagation and store-guard paths
as levels always did, generalized from "base" to "base or top". Same DAG, same
one-directional rule — the stair depends on the levels, never the reverse.

## Golden decision 3: straight flight only in V1

Like roofs (mono-pitch first), the stair is a single straight flight —
geometry that derives exactly from origin + direction + rise. Quarter/half
landings, winders, and switchbacks need an intermediate landing datum and a
poly-flight model; deferred rather than approximated. A U-stair is two V1
flights today.

## Geometry

- **Plan** — the CAD stair symbol: the flight outline, a tread line at each
  going, and an up-arrow along the centerline pointing to the top.
- **3D** (`IMeshable`) — a stepped solid, one box per going rising by the
  actual riser from the base elevation (`extrudeQuad` + `mergeMeshes`, the
  wall/slab mesh path). Shows the flight climbing between the two levels.

## Integration

- `entities/architecture/stair-entity.ts` — `ILevelAware` (`vertical:
{height} | {topLevelId}`), `IMeshable`, `IGrippable` (origin + direction
  grips). `getRise()` / `getRiserCount()` / `getRunLength()` are the derived
  readouts.
- `commands/stairs.ts` — `STAIR.ADD {origin, direction?, width?, baseLevelId?,
topLevelId?, height?}`. No AUTO macro: stairs are placed deliberately, not
  derived from other geometry (there is no "one stair per room").
- **document** — `_emitChange` and `LEVEL.REMOVE` generalized to base-or-top
  (above).
- **Quantities** — `stairCount` plus a `stairs` list (rise, riser count,
  tread count); the LLM digest gains `stairCount`.
- **Estimator** — each stair bills one `stair` count line (a fabricated item
  is priced per flight); richer per-riser / by-material stair costing is
  deferred.
- **web-editor** — a Stair palette tool (click origin, click direction; the
  base is the active level and the top is the next level up by elevation, or a
  3 m flight when there is none) and a `STAIR` command-line keyword; demo rate
  prices the flight.

## Known V1 limitations

- **Single straight flight** — no landings, winders, or switchbacks.
- **No stringers / balustrade / nosing** — a symbolic stepped solid, not a
  fabrication model.
- **No floor-opening cut** — the stair does not punch a shaft through the slab
  above (slab penetrations are their own deferred item).
- **Fixed going / max-riser constants** — not yet a stair type with
  configurable treads.
- **Flat-height variant does not track a datum** — only `{topLevelId}`
  participates in cross-level recompute; a `{height}` stair is static.

## Deferred

Multi-flight stairs with landings; winders; stair types (configurable going /
riser / material); stringers and balustrades; slab shaft cutting; ramps
(a stair with going→∞ / a single sloped run — shares the sloped-run math with
roofs).

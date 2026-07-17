# Slabs / Floors

Status: **Decided** (V1 shipped 2026-07-17)

The first area entity: a closed polygon footprint + a level + an assembly
build-up. Slabs complete the spaces→dimensions→slabs chain — one
`SLAB.AUTO` dispatch floors every detected room — and they widen the
BOQ from one trade (walls) to multi-trade (concrete, screed, finishes).

## Golden decision 1: the standard 2.5D recipe, extruding DOWN

A slab is plan truth + vertical data, like every entity: the 2D footprint is
authored, 3D is derived. The **top face sits flush with the level elevation**
and the body extrudes downward by the assembly thickness — you stand *on*
the level, and a Level 2 slab's underside is naturally Level 1's ceiling.
Multi-storey stacks need no special casing.

Thickness follows the wall pattern exactly: a `SlabType` in the type catalog
(`targetType: 'slab'`) with ordered assembly layers wins over the local
`thickness` prop (default 0.2 m). For a slab the layers are a vertical stack,
so the thickness-proportional material split is exact, not approximate.

## Golden decision 2: SLAB.AUTO floors rooms from NET boundaries

The macro creates one slab per detected space using the room's **net
boundary** — the polygon along inner wall faces. That is the floor you
screed and tile, matching the finish-region vision, and it is what per-room
flooring trades price. A structural plate that runs *under* the walls is a
different object: draw it manually with `SLAB.ADD` on the building outline
(the arrangement's outer contour is the deferred automation slot).

Like `DIM.AUTO`, the macro **regenerates**: slabs it previously created on
the level (`auto: true`) are deleted and rebuilt from current rooms — one
transaction, one undo, idempotent under re-run. It returns
`{removed, created, totalArea}` so an agent gets its feedback without
re-digesting the document. Hand-placed slabs are never touched.

## Geometry: polygon extrusion lands in `geometry/mesh`

Rooms are L-shaped and worse, so the promised triangulation slot in
`geometry/mesh/` is now filled: `triangulateLoop` (ear clipping over simple
polygons, either winding) and `extrudePolygon` (triangulated caps + side
quads). Walls keep using `extrudeQuad`; any future footprint entity reuses
`extrudePolygon`.

## Integration

- `entities/architecture/slab-entity.ts` — `ILevelAware` (`height: 0`;
  vertical extent derives from thickness), `IMeshable`, `IGrippable`
  (vertex grips). Renders in plan as a region (fill for free), hit-tests by
  point-in-polygon or boundary proximity.
- `commands/slabs.ts` — `SLAB.ADD {points, thickness?, typeId?, levelId?}`
  and `SLAB.AUTO {levelId?, typeId?}`.
- **Quantities** — `computeQuantities` gains per-slab area/volume, totals,
  and the same assembly-proportional material split walls use; the LLM
  digest's quantity block reports `slabArea`/`slabVolume`.
- **Estimator** — `computeSlabTakeoff` facts (area, thickness, volume,
  resolved assembly) feed `assembleBoq`; typed slabs split per cost code,
  untyped fall back to a generic `slab-volume` line. Waste-factor rules
  apply as policy, unchanged.
- **web-editor** — Slab palette tool (polyline-style vertex clicking, click
  the first vertex or press Enter to close), `SLAB` / `SLABAUTO` command-line
  keywords (`SLABAUTO` floors the active level with the seeded slab type),
  demo catalog seeds a "Slab 200 (15+5)" type and EUR rates, and the 3D view
  shows slabs automatically through `IMeshable`.

## Known V1 limitations

- **No openings** — stair shafts / penetrations need footprint holes; the
  entity data model reserves the slot (`RegionShape` already supports holes)
  but V1 stores a simple boundary.
- **SLAB.AUTO skips island holes** — a room with a detached enclosure gets
  a full slab under the island contour.
- **No slab-wall relation** — moving walls does not stretch hand-placed
  slabs; re-running `SLAB.AUTO` refreshes auto slabs instead.
- **No sloped slabs / ramps** — flat extrusion only (the roof arc's slope
  parameter is the landing slot for both).

## Deferred

Footprint holes + shaft cutting; structural plate automation from the
arrangement's outer contour; slab edge conditions (thickenings, upstands);
per-room finish build-ups layered on top of the structural slab; ramps.

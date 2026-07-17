# Spaces / Room Detection

Status: **Decided** (V1 shipped 2026-07-17)

Closed regions bounded by walls are detected automatically and reported as
spaces (rooms) with net and gross boundaries and areas. Draw four perimeter
walls and a partition tee'd into them anywhere along their length — the model
reports two rooms, not one. Delete the partition and they merge back. Spaces
are what make a drawing *addressable*: "the 14 m² room on Level 1" for agents,
room areas for the estimator, room boundaries for future slabs and finishes.

## Golden decision 1: spaces are derived, never stored

Same rule as wall joins: no space entity, no relation, no flag in `saveData()`.
A space is a **consequence of wall geometry**, recomputed on read by a free
function — `detectSpaces(doc, levelId)` in `measurements/`. Move a wall and
the rooms change on the next read; undo/collaboration are untouched because
spaces are not state.

Explicitly re-affirmed: no caching on `DrawingDocument`. Caching a derived
arrangement on the document was tried once and reverted as a Layer-2/Layer-3
drift — the free-function pattern is the settled convention. Add a cache only
when profiling demands it, and put it in the consumer, not the document.

When users need to *name* a room or override its function, that becomes a
thin stored tag entity pointing at a detected space by location — the tag
stores data, never geometry. Deferred until needed.

## Golden decision 2: detection runs on a planar arrangement, not an endpoint graph

A partition that tees into another wall's body never shares an endpoint with
it, so endpoint-cycle detection would see a 4-wall house with internal
partitions as one big room. Detection therefore builds a **planar
arrangement** of wall baselines (`topology/arrangement.ts`, pure math, no
entities):

1. **Tee snapping** — a baseline endpoint within `halfWidth + JOIN_TOLERANCE`
   of another wall's baseline interior snaps onto it and splits it there.
   The `halfWidth` allowance means walls drawn to a host's *face* (flush,
   joins V2 style) connect exactly like walls drawn to its centerline.
   Splits happen at **any** parameter along the host — T at 1/3, T at 0.9,
   wherever the partition lands. Nearest host wins, matching `teeCap`.
2. **Crossing splits** — baselines that properly cross (X) split each other
   at the intersection point.
3. **Node clustering** — endpoints within `JOIN_TOLERANCE` merge into one
   graph node (the same tolerance that makes walls join).
4. **Face extraction** — half-edge traversal, leftmost-turn rule. Bounded
   faces (positive signed area) are space candidates; the unbounded face is
   the outside world. Dangling wall stubs traverse as zero-area spikes inside
   their containing face — no special case.
5. **Islands become holes** — a detached closed loop inside a room (a shaft,
   a freestanding enclosure) surfaces as a hole of the containing face and
   its area is subtracted.

The wall-joins invariant holds throughout: **discovery reads baselines only,
never derived face geometry**, so detection cannot depend on its own output.

Doors and windows do not leak spaces for free: openings are subtracted from
*effective* geometry while baselines stay continuous, so a doorway still
bounds the room. This is a consequence of the base/effective split, not a
special case — and a test asserts it stays true.

## Golden decision 3: every space has two boundaries — gross and net

A room bounded by 30 cm walls is smaller than its baseline polygon. Each
detected space carries both:

- **Gross boundary** — the baseline (centerline) loop. Matches the
  estimator's deliberately centerline-based wall takeoff.
- **Net boundary** — the loop pulled in to each wall's **room-side face**:
  per boundary edge, offset by that wall's `getThickness() / 2` (assembly
  layers from the type catalog win over the local prop, so a 20 cm build-up
  shrinks the room by 10 cm per side of each wall). Consecutive face lines
  intersect at corners, exactly like junction miters; parallel-but-offset
  neighbors (different thicknesses in line) connect with a jog; a dangling
  stub gets a squared notch around its tip.

Net is what finishes, floor areas, and room schedules want; gross is what
keeps space math consistent with wall quantities. Consumers pick; the digest
reports both.

The face side convention is the one `WallEntity.getAnchors()` already
established: `face+` lies on `+perpendicular(normalize(b − a))` (left of
baseline travel), `face-` on the right. Dimensions will bind to the same
`face+`/`face-` selectors — one side of a wall chain measures inner clear
widths, the other measures outer overall extents.

## Integration

- `topology/arrangement.ts` — `arrangeSegments(segments, tolerance)`: pure,
  entity-free, testable in isolation (the junctions.ts pattern). Each face
  edge remembers its source segment id and is oriented interior-on-the-left.
- `measurements/spaces.ts` — `detectSpaces(doc, levelId)`: collects walls the
  way plan views do (`baseLevelId === levelId`, level-unassigned walls appear
  on every level), feeds the arrangement, builds gross/net polygons, returns
  `SpaceInfo[]` sorted stably. Layer visibility is ignored — spaces are a
  model fact, like quantities.
- **LLM digest** — `describeDocument()` gains a `spaces` section:
  `{ key, level, netArea, grossArea, walls }` per space, a few tokens per
  room. Agents address rooms instead of reasoning over wall envelopes.
- **web-editor** — plan viewports fill detected spaces and label them with
  their net area, recomputed per committed transaction. Rooms light up as a
  loop closes and merge when a partition is erased.
- Space keys are centroid-derived (`s@x,y` rounded to 0.1 m) — stable across
  unrelated edits, best-effort across edits that move the room itself.

## Known V1 limitations

- **Gap tolerance is JOIN_TOLERANCE only** (1e-4 m). Walls left 5 cm apart do
  not bound a room — rooms merge through the gap, exactly as they would
  through a real 5 cm slot. No gap-healing heuristic; snapping is the tool.
- **Straight baselines only** — curved walls don't exist yet; when they do,
  the arrangement needs curve–curve splitting.
- **Overlapping collinear walls** are deduplicated per node pair, not
  boolean-merged; pathological overlaps can produce sliver faces (filtered
  by a minimum-area threshold of 0.01 m²).
- **Hole net boundaries** — island holes subtract their *gross* loop area;
  the island's own face offset is not applied to the hole boundary.
- **Net corner construction is offset-based**, mirroring junction miters. If
  exotic plans accumulate corner cases, the fallback is polygon booleans in
  the reserved "2D boolean topology" slot — swap the net-polygon builder,
  keep the arrangement.
- **No open-plan subdivision** — only walls bound spaces. Room separator
  lines (zero-thickness space boundaries, the Revit device) are deferred.

## Deferred

Stored space tags (names, functions — data only, geometry stays derived);
room separator lines; wall justification (`center | face+ | face-` — becomes
a stored wall property that face math reads; requires asymmetric half-widths
in the junction resolver); core-vs-finish face distinction on assembly layers
(dimension-to-core); polygon-boolean net construction; gap-healing tolerance.

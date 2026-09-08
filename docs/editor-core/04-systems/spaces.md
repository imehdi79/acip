# Spaces / Room Detection

Status: **Decided** (V1 shipped 2026-07-17)

Closed regions bounded by walls are detected automatically and reported as
spaces (rooms) with net and gross boundaries and areas. Draw four perimeter
walls and a partition tee'd into them anywhere along their length — the model
reports two rooms, not one. Delete the partition and they merge back. Spaces
are what make a drawing _addressable_: "the 14 m² room on Level 1" for agents,
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

Naming works the same way, and shipped as designed (2026-08-08): a name is a
thin stored tag entity — `SpaceTagEntity`, type `space-tag` — anchored at a
point inside the room it names. The tag stores data, never geometry: it draws
no linework, is not pickable (a tap inside a room still selects the room), and
resolves to a space by containment, so the name follows the room through wall
edits that keep the anchor inside it. `SPACE.SETNAME` creates, renames (never
stacking a second tag) or, on an empty name, removes it. A tag whose room is
demolished is simply orphaned — it names a room again if the loop closes back
around it. Overriding a room's _function_ (a schedule category) is still open,
and belongs on the same tag.

## Golden decision 2: detection runs on a planar arrangement, not an endpoint graph

A partition that tees into another wall's body never shares an endpoint with
it, so endpoint-cycle detection would see a 4-wall house with internal
partitions as one big room. Detection therefore builds a **planar
arrangement** of wall baselines (`topology/arrangement.ts`, pure math, no
entities):

1. **Tee snapping** — a baseline endpoint within `halfWidth + JOIN_TOLERANCE`
   of another wall's baseline interior snaps onto it and splits it there.
   The `halfWidth` allowance means walls drawn to a host's _face_ (flush,
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
_effective_ geometry while baselines stay continuous, so a doorway still
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
- `measurements/spaces.ts` — `detectSpaces(doc, levelId, query?)`: collects
  walls the way plan views do (`baseLevelId === levelId`, level-unassigned
  walls appear on every level), feeds the arrangement, builds gross/net
  polygons, returns `SpaceInfo[]` sorted stably. Layer visibility is ignored by
  default — spaces are a model fact, like quantities, and hiding a layer must
  not silently drop rooms from a schedule.
  - `{ visibleOnly: true }` (added 2026-08-12) is the exception a plan VIEW
    needs: it may only shade and label rooms whose walls are on the screen.
    The flag re-runs the arrangement without hidden walls rather than
    filtering finished rooms — the difference between "a hidden partition no
    longer divides this room" (one room) and "both halves touch a hidden wall,
    drop them" (no room at all). Renderer and room-picking pass it; the
    estimator, finishes and the LLM digest do not.
- **Names** — `findSpaceTag(doc, space)` / `spaceName(doc, space)` in
  `measurements/spaces.ts`: the read side of naming, free functions like
  everything else here. Consumers draw the name wherever they already put the
  room label.
- **LLM digest** — `describeDocument()` gains a `spaces` section:
  `{ key, name, level, netArea, grossArea, walls }` per space, a few tokens per
  room. Agents address rooms by name when there is one, instead of reasoning
  over wall envelopes.
- **web-editor** — plan viewports fill detected spaces and label them with
  their net area, recomputed per committed transaction. Rooms light up as a
  loop closes and merge when a partition is erased.
- Space keys are centroid-derived (`s@x,y` rounded to 0.1 m) — stable across
  unrelated edits, best-effort across edits that move the room itself.

## Known V1 limitations

- **Gap tolerance is JOIN_TOLERANCE only** (1e-4 m). Walls left 5 cm apart do
  not bound a room — rooms merge through the gap, exactly as they would
  through a real 5 cm slot. No gap-healing heuristic; snapping is the tool.
- ~~**Straight baselines only**~~ — RESOLVED 2026-09-08, and not the way this
  note expected. Curved walls do not need curve–curve splitting: a wall enters
  the arrangement as `getCentreline()`, which is two points when straight and a
  tessellated run when curved, all under the wall's own id. The arrangement
  stays entirely segment-based and never learns what an arc is, while the room
  gets the area the curve really encloses. Faces dedupe by id, so a curved wall
  is still ONE bounding wall and is billed once. See
  [curved-walls.md](curved-walls.md).
- **A curve past a half turn picks its room face by chord** — `boundaryFaces`
  compares the edge direction against the wall's chord, which is right for any
  sweep under 180° and can flip beyond it. Rare enough to name rather than fix.
- **Overlapping collinear walls** are deduplicated per node pair, not
  boolean-merged; pathological overlaps can produce sliver faces (filtered
  by a minimum-area threshold of 0.01 m²).
- **Hole net boundaries** — island holes subtract their _gross_ loop area;
  the island's own face offset is not applied to the hole boundary.
- **Net corner construction is offset-based**, mirroring junction miters. If
  exotic plans accumulate corner cases, the fallback is polygon booleans in
  the reserved "2D boolean topology" slot — swap the net-polygon builder,
  keep the arrangement.
- **No open-plan subdivision** — only walls bound spaces. Room separator
  lines (zero-thickness space boundaries, the Revit device) are deferred.

## Deferred

Space functions/categories on the tag (names shipped 2026-08-08);
room separator lines; wall justification (`center | face+ | face-` — becomes
a stored wall property that face math reads; requires asymmetric half-widths
in the junction resolver); core-vs-finish face distinction on assembly layers
(dimension-to-core); polygon-boolean net construction; gap-healing tolerance.

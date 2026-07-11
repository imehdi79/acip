# Wall Joins / Corner Cleanup

Status: **Decided** (V1 shipped 2026-07-12) · V2 deferred

Walls whose baseline endpoints coincide clean up their shared corner
automatically — the plan shows a mitered corner instead of two overlapping
square-capped rectangles, and the 3D extrusion follows.

## Golden decision: joins are derived, never stored

There is no "join entity", no relation, no flag in `saveData()`. A join is a
**consequence of geometry**: endpoints within `JOIN_TOLERANCE` (1e-4 m) of each
other miter against each other; drag a wall away and the join dissolves on the
next read. This follows golden rule 4 (anything not saved is derived) and keeps
undo/collaboration untouched — a commit record never mentions joins because
joins are not state.

Consequences accepted with the decision:

- No per-corner user overrides in V1 (join opt-out, butt vs miter choice).
  When those arrive they become *stored* properties on the wall ends — the
  derived resolver just reads them.
- Quantities stay **centerline-based**; the miter does not change takeoff.
  This matches common measurement rules and keeps the estimator independent.

## The wheel algorithm (`topology/junctions.ts`)

Pure math over `WallEnd { point, direction, halfWidth }` descriptors —
`direction` is a unit vector pointing *away* from the junction into the wall.
The resolver never sees entities.

1. Sort ends by arrival angle around the junction.
2. For each pair of angle-adjacent walls, intersect the CCW wall face of one
   with the CW face of the next → one shared corner per gap, computed **once**,
   so adjacent walls share corner points exactly (watertight plan + mesh).
3. Each wall's cap = the two corners flanking it (`EndCap { left, right }`,
   aligned with input order).

Fallbacks, in order:

- **Parallel faces** (collinear walls): no intersection → both walls keep flush
  square caps at the junction line.
- **Miter limit**: near-collinear intersections are clamped to
  `8 × max(halfWidth)` from the junction so spikes stay bounded.
- **Single end**: square cap (a wall alone is not a junction).

N-way star junctions fall out of the same loop — no special case.

## Integration: one seam in WallEntity

`WallEntity.junctionCap(which)` finds neighbors via the document's spatial
index (walls with an endpoint within tolerance), builds `WallEnd` descriptors,
and takes its own cap from `resolveJunction`. `spanQuadJoined` swaps the cap
corners into the terminal span quads. Everything downstream is untouched:

- plan regions (`getEffectiveGeometry`) — mitered outline
- 3D (`toMesh`) — extrudes the same joined quads
- bounds, hit-test region fill, renderer — follow the geometry for free

Anchors stay baseline-based, so hosted openings (windows/doors) keep their
parametric placement regardless of joins.

## Known V1 limitations

- **Opening bands at corners**: a window/door sill or lintel band flush against
  a mitered end keeps its square quad (visual only, exotic case).
- **Neighbor staleness**: joining/moving wall A does not mark wall B dirty (no
  relation exists). Rendering is correct (the scene redraws whole), but B's
  spatial-index bbox can lag by one touch — revisit if hit-testing exactly at
  miter tips ever matters.
- **Vertical mismatch ignored**: walls of different heights/levels still miter
  in plan; the 3D seam is not resolved.

## V2 (deferred): T-junctions

Endpoint-touching-interior (a wall ending on another wall's face, not its
endpoint). Plan: detect endpoint-on-segment in `junctionCap`, clip the ending
wall to the near face of the continuous wall; the continuous wall is untouched.
Same derived-not-stored rule.

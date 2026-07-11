# Wall Joins / Corner Cleanup

Status: **Decided** (V1 + V2 T-junctions shipped 2026-07-12)

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

### Invariant discovered during V2: wall bounds must include the baseline

Join caps can clip the effective body AWAY from a baseline endpoint (a tee
stops at the host's face). Junction discovery queries the spatial index by
endpoint, and the spatial index stores bounds — if bounds came only from the
capped effective geometry, a joined wall's own endpoint could fall outside its
bbox and discovery would depend on its own output (walls tee'd into a host
instead of finding each other). `WallEntity.getBounds()` therefore unions the
effective-geometry bbox with the baseline bbox. Rule for future join-like
features: **anything used to DISCOVER a derived relationship must be
independent of that relationship's result.**

## T-junctions (V2)

A wall END touching another wall's BODY away from its endpoints butts against
that wall's **near face**; the continuous wall is untouched.

- **Detection** (in `junctionCap`, only when no shared-endpoint neighbors
  exist — the wheel always wins): endpoint within `halfWidth + JOIN_TOLERANCE`
  of a host's baseline segment, with the perpendicular foot in the segment's
  interior. Works whether the wall was drawn to the host's centerline (gets
  clipped back) or snapped to its face (already flush). Nearest host wins.
- **Math** (`resolveTeeCap`, pure): intersect the ending wall's two face lines
  with the host's near-face line; the near face is the side the ending wall's
  direction points toward. Parallel → null (no butt possible, square cap).
  Shallow incidence corners clamp to the miter limit.
- **Quantities unchanged** — centerline-based; the plan/mesh area of the tee'd
  wall shrinks by `halfWidth(host) × thickness` (geometric truth), but takeoff
  reads the baseline.

## Known V1 limitations

- **Opening bands at corners**: a window/door sill or lintel band flush against
  a mitered end keeps its square quad (visual only, exotic case).
- **Neighbor staleness**: joining/moving wall A does not mark wall B dirty (no
  relation exists). Rendering is correct (the scene redraws whole), but B's
  spatial-index bbox can lag by one touch — revisit if hit-testing exactly at
  miter tips ever matters.
- **Vertical mismatch ignored**: walls of different heights/levels still miter
  in plan; the 3D seam is not resolved.
- **Wheel-over-tee overlap**: when two walls share an endpoint ON a third
  wall's body, they miter with each other (wheel priority) and their miter can
  overlap the host's body in plan. Fills overlap harmlessly; no boolean
  cleanup in V2.
- **Crossing (+) junctions**: interior-crossing-interior is not detected —
  detection is endpoint-driven only.

## Deferred beyond V2

Per-corner overrides (join opt-out, butt vs miter choice — become stored wall
properties read by the resolver), crossing junctions, vertical seam
resolution, boolean cleanup of overlapping plan fills.

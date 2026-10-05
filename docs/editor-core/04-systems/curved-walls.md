# Curved Walls

Status: **Decided** (shipped 2026-09-10)

A wall may bow between its two endpoints. It is still one wall, with one
length, one takeoff line and one dimension — it simply turns on the way.

## Golden decision: chord and sweep, never centre and radius

A curved wall stores its two endpoints and `sweep`: how far it turns between
them, in radians, signed toward `face+`. Zero is straight and costs nothing.

The centre and radius are DERIVED on every read, exactly like a join. This is
the decision everything else rests on, and the reason is ownership: the two
endpoints are what the rest of the drawing is holding on to — the walls welded
to them, the grips, the snapping, `planStickyWallMove`, the room arrangement.
A stored centre is a second, competing account of where the wall is, and the
moment an endpoint is dragged it is wrong. Deriving means a curved wall can be
dragged, joined, resized and jogged by machinery that never heard of arcs.

It also means the awkward cases are answered rather than stored: a sweep is
clamped just short of a full turn, where the chord vanishes and the radius runs
away.

## Length is ARC length

`getLength()` returns the arc. That is what the wall is made of, so it is what
the takeoff prices, what the dimension prints, and what openings are placed
along.

This one line is why openings needed no work at all. They were already placed
by DISTANCE along the wall (`spec.t * len`, spans in meters), so arc-length
parametrisation carries them for free — a window keeps its position along the
curve, and the solid spans either side of it get longer because the wall did.

## One band, three features

`spanQuadJoined` builds the plan outline as two FACES walked along the
centreline, rather than as a quad with corners poked into it. Three features
share that one path without knowing about each other:

- a junction **cap** replaces a face's end point;
- a corner **jog** trades that end point for the three of a riser;
- **curvature** simply puts more points in between.

A straight wall with no jog samples exactly its two ends and comes out as the
identical four-cornered quad it always was. That is asserted, not hoped for.

## Joins meet the tangent

`endDirection(which)` returns the tangent on a curve and the chord on a
straight wall, and both this wall and its neighbours are asked for it. On a
curved wall the tangent and the chord differ by half the sweep — more than
enough for a corner cut to the chord to visibly miss.

## Rooms without curve–curve splitting

`spaces.md` used to say curved walls would need curve–curve splitting in the
arrangement. They do not. `getCentreline()` hands the topology a polyline — two
points when straight, tessellated when curved — and every segment carries the
wall's own id. The arrangement stays segment-based; faces dedupe by id, so the
room still reports one bounding wall and bills it once.

Tessellation follows CURVATURE, not length: at most 7.5° per piece, so a tight
little arc is as smooth as a long sweeping one and a nearly straight wall costs
almost nothing.

## The middle of the wall is the handle, and it is NOT a grip

`getBendPoint()` is the middle of the wall: the apex on a curve, the midpoint
of the chord on a straight one. Not the centre — the centre of a gentle curve
is hundreds of meters off the plan and cannot be reached at all. The apex is on
the wall, under the finger, and moves the way the wall moves.

`planBend(apex)` answers with the sweep that would put the wall under that
point and the centreline it would come out as, without changing anything. A
tool previews the centreline and commits the sweep through `WALL.SETARC`, so
what is drawn during the drag and what lands afterwards are one answer read
twice — the same pairing `planEndDrag` gives an opening's end grip.

Only the across-chord part of the drag counts. A circular arc through two
points has its apex at the middle, so sliding along the wall says nothing and
must not be invented into a different curve. Crossing the chord flips the bow
rather than sticking or jumping.

**It is deliberately not a grip.** `getGrips()` returns the two ends and
nothing else. A grip is a point the wall STORES and the drawing holds on to:
junctions weld to them, a sticky corner carries every grip sharing a spot, a
resize moves them, drag-snap treats them as nodes to catch on. The bend point
is produced by the sweep, not stored, and listing it among the grips would hand
it to all of that machinery as a corner it is entitled to drag — a wall teeing
into another wall's middle would bend its host the moment that corner moved.

The editor draws it instead (`apps/editor/src/editor/curve.ts`) as a round
button standing off the wall by a fixed number of SCREEN pixels, with a leader
back to the point it bends. Off the wall for a reason worth writing down: the
middle of a wall is also the most natural place to grab it and drag the wall
somewhere, and a button sitting on it would take that gesture away. The drag is
read as a DELTA — the wall bows by what the finger moved across it — so the
button stays under the finger and the stand-off never has to be subtracted back
out.

## What else follows the curve

Anything laid ALONG a wall has to be read off the wall's own centreline, or it
comes off the wall the moment the wall bows:

- **Openings** — `getAnchors()` hands back a polyline axis on a curved wall, so
  a hosted opening parametrises itself along it (`polylineFrameAt`,
  `closestParamOnPolyline`). `t` was never a position along a straight line; it
  is a fraction of the distance along the host, and reading it that way is what
  carries a window round the bend instead of leaving it behind. A two-point
  axis takes the same segment arithmetic it always did.
- **Assembly strips** — `wallAssemblyStrips` offsets from `getFrames(s0, s1)`
  rather than from the chord, so the layers and their separators curve with the
  wall.

And one that deliberately does NOT: `WALL.RESOLVE` skips curved walls in both
directions. Overlap is decided on the baseline, and a bowed wall's baseline is
a chord it does not run along — splitting it there would cut it where it never
passes and leave both pieces turning the whole sweep, and letting it cut others
would erase a straight wall to make room for a wall that is somewhere else.

## How a bowed wall is dimensioned

The plan's `inside` / `outside` setting means exactly what it means on a
straight wall — which BOUNDARY of the wall is measured, decided from the plan's
middle — and on a bow the two boundaries are genuinely different arcs:

| mode      | measured                                        |
| --------- | ----------------------------------------------- |
| `outside` | the boundary facing away from the plan's middle  |
| `inside`  | the boundary facing into it                      |

Both are concentric with the centreline arc: same centre, same angular extent,
a radius half a thickness further out or in. So the number is
`radius * |sweep|` on THAT radius — never the chord (which is shorter than
either), and never the centreline arc (which is neither of them).

Corner caps still count for what they always counted for. The wall's own drawn
outline is walked and every corner placed along the wall by its ANGLE about the
arc's centre, which is the bowed wall's version of projecting a corner onto the
axis. A wall mitered into a corner therefore has its inner arc cut back exactly
where core drew the miter — which is what a clear width is.

Two things have to change together for this and they change for one reason: a
bow puts its inner face on the far side of its own chord. So which side of the
chord a corner falls on says nothing about which FACE it came from (the face is
decided by which side of the centreline RADIUS it falls on), and how far along
the chord it projects says nothing about how much WALL is behind it.

A second dimension carries the DEPTH: the rise from the chord between the two
measured anchors to the apex of that same boundary, from the geometry package's
own `arcSagitta`. It is the number that cannot be derived from a length, and it
is read off whichever boundary the mode named — there is no separate setting for
it, and there should not be one.

The editor draws the length ALONG the boundary, stood off into its lane
radially, so the linework spans what the label claims; the depth is drawn inside
the bow, from the dashed chord to the apex, with its label pushed along the
chord to clear the arrow and the bend handle.

## Known limitations

- **Face side beyond a half turn** — room-face assignment compares the edge
  direction to the chord, which can flip past 180°.
- **No tangent continuity between walls** — two curved walls meeting are
  mitered, not blended; there is no arc-to-arc fillet.
- **`transform` moves endpoints only** — mirroring a curved wall does not flip
  the sign of its sweep, so a mirrored curve bows the same way.
- **A typed length is the ARC, so the chord comes out shorter** — the resize
  holds the sweep, and the Measurements field scales its delta by chord/arc so
  the wall ends up the length the plan printed. The two endpoints therefore end
  up closer together than the typed number, which is correct and still worth
  knowing before measuring between them.
- **Bending is per wall** — the button acts on the wall it belongs to, so
  bending a whole room is four drags.
- **A wall mitered into a bowed one measures differently** — its corner is now
  cut against the neighbour's tangent, so its own drawn extent moves. That is
  the drawn corner, faithfully, not a dimension bug.

## Deferred

Arc-to-arc tangency, dimensioning along the curve, radius-driven entry (typing
a radius instead of an angle), and elliptical walls.

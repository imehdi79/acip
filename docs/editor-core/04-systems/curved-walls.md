# Curved Walls

Status: **Decided** (shipped 2026-09-08)

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

## The apex is the handle

Grip 2 exists only on a curved wall and sits at the apex. Not the centre — the
centre of a gentle curve is hundreds of meters off the plan and cannot be
dragged at all. The apex is on the wall, under the finger, and moves the way
the wall moves. Dragging it runs `sweepFromApex` backwards to the sweep that
puts the curve under the finger; dragging across the chord flips the bow rather
than sticking or jumping.

Only the across-chord part of the drag counts. A circular arc through two
points has its apex at the middle, so sliding along the wall says nothing and
must not be invented into a different curve.

## Known limitations

- **Face side beyond a half turn** — room-face assignment compares the edge
  direction to the chord, which can flip past 180°.
- **Dimension line on the chord** — a curved wall is dimensioned across its
  chord and labelled with its arc length. That is the drafting convention and
  the only useful pair, but the line does not follow the wall.
- **No tangent continuity between walls** — two curved walls meeting are
  mitered, not blended; there is no arc-to-arc fillet.
- **`transform` moves endpoints only** — mirroring a curved wall does not flip
  the sign of its sweep, so a mirrored curve bows the same way.

## Deferred

Arc-to-arc tangency, dimensioning along the curve, radius-driven entry (typing
a radius instead of an angle), and elliptical walls.

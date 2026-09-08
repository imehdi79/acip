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

## Two handles, both derived

Grips 2 and 3 exist only on a curved wall. Neither is a point the wall stores —
both are produced by the sweep — so dragging either works backwards to the
sweep that would put it under the finger.

**Grip 2, the APEX.** On the wall, under the finger, always reachable. Dragging
it across the chord flips the bow rather than sticking or jumping. Only the
across-chord part of the drag counts: an arc through two points has its apex at
the middle, so sliding along the wall says nothing and must not be invented
into a different curve.

**Grip 3, the CENTRE** — the point the wall turns about, and how a curve is
struck on paper. It is the second handle, not the first, because on a gentle
curve it is hundreds of meters off the plan; on a tight one it is right there.

The centre is constrained twice over, and both constraints are geometry rather
than choices:

- It can only travel the **perpendicular bisector** of the chord, because that
  is the only line a circle through both endpoints can be centred on. The rest
  of the drag asks for a circle that does not exist, and nothing happens.
- It cannot say **which way** the wall bows. Every centre on the bisector
  carries two arcs through the same two points, one bulging each way, so the
  bow direction is taken from the wall as it already is and only the amount of
  turn comes from the drag.

That second rule is also what keeps the wall from flipping inside out as the
centre is pulled through the chord. Instead the turn grows smoothly past a half
circle — which is exactly what pushing the centre toward the wall looks like.

## Known limitations

- **Face side beyond a half turn** — room-face assignment compares the edge
  direction to the chord, which can flip past 180°.
- **Dimension line on the chord** — a curved wall is dimensioned across its
  chord and labelled with its arc length. That is the drafting convention and
  the only useful pair, but the line does not follow the wall.
- **No tangent continuity between walls** — two curved walls meeting are
  mitered, not blended; there is no arc-to-arc fillet.
- **A gentle curve's centre is off the plan** — the centre grip is real but can
  be unreachable at a shallow sweep. The apex always works; that is why it is
  the first handle.
- **`transform` moves endpoints only** — mirroring a curved wall does not flip
  the sign of its sweep, so a mirrored curve bows the same way.

## Deferred

Arc-to-arc tangency, dimensioning along the curve, radius-driven entry (typing
a radius instead of an angle), and elliptical walls.

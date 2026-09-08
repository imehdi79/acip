# Dimensions

Status: **Decided** (V1 shipped 2026-07-17)

Linear dimensions with the two-sided wall rule: a dimension binds to a wall's
`face+`, `face-`, or `axis`, so one side of a wall chain measures **inner
clear widths** (face to face inside a room) and the other measures **outer
overall extents**. `DIM.AUTO` applies the rule automatically from detected
spaces.

## Golden decision 1: the entity is stored, the value never is

Unlike spaces (fully derived), a dimension is authored content — a stored
annotation entity. But it stores **references, not numbers**: the measured
value, the extension lines, the ticks, and the text are all derived on every
read. `saveData()` holds only the definition (`points` or `walls` mode),
the signed offset, and the `auto` flag. Change what a dimension references
and it re-measures on the next read — golden rule 4, applied to annotation.

## Golden decision 2: wall references resolve through the side convention

A `walls`-mode dimension stores `{ wallA, sideA, wallB, sideB, t }` with
sides from the spaces.md convention (`face+` = left of baseline travel).
Resolution on read: anchor point = wall A's side line at parameter `t`,
measured to the perpendicular foot on wall B's side line. Consequences:

- **Stretch a wall** → the dimension follows.
- **Change a wall type's assembly build-up** → the faces move, the clear
  width re-measures. A 20 cm assembly becoming 30 cm shrinks the room _and_
  its dimensions, with no dimension edit.
- **Delete a referenced wall** → the reference is unresolvable and the
  dimension renders nothing (stale, like wall-join neighbor staleness).
  No relation edge in V1; cascade cleanup is deferred.

`points` mode is the static fallback (free measurements, and everything
`DIM.AUTO` generates — see below).

## Golden decision 3: DIM.AUTO regenerates, it does not maintain

Auto-dimensioning is a _derivation_, so `DIM.AUTO` deletes every dimension it
previously created on that level (`auto: true` in props) and rebuilds from
current geometry — one transaction, one undo, idempotent under re-run.
Generated dimensions are `points`-mode snapshots; re-running after edits is
the refresh. Hand-placed `DIM.ADD` dimensions are never touched.

What it generates:

- **Inner (per detected space)**: the net boundary from `detectSpaces` —
  corners already sit on inner wall faces — is collinear-merged, edges are
  grouped by direction, and the longest edge per direction gets a clear-width
  dimension offset _into_ the room. A rectangular room gets its width and
  height; an L-room gets one per direction of its outline.
- **Outer (per level)**: the union of wall bounds — which include thickness
  and join caps, i.e. **outer** extents — gets an overall width below the
  plan and an overall height to its left.

## Text is geometry: `TextShape`

Dimensions are the first text-bearing entity, so the `Geometry` union gains
`TextShape { anchor, text, height, rotation }` — height in world meters,
rotation in radians, anchor at the text center. Core stays headless: it never
measures fonts (bbox is a conservative estimate); _drawing_ text is the
renderer's job, like every other shape. Text auto-flips to stay readable
(never upside-down). Future TextEntity/labels reuse the same shape.

## Integration

- `entities/annotations/dimension-entity.ts` — `DimensionEntity`
  (`ILevelAware`, height 0, so plan views filter it per level; not
  `IMeshable`, so 3D ignores it). Plan symbol: extension lines with gap and
  overrun, dimension line, 45° ticks, value text (`toFixed(2)`, meters).
- `commands/dimensions.ts` — `DIM.ADD` (points or walls mode) and
  `DIM.AUTO {levelId?, inner?, outer?}` returning `{removed, created}` —
  compact agent feedback, no re-digest needed.
- Agents gain both commands automatically through the registry; the
  interesting agent call is one `DIM_AUTO` per level — intent-level, a
  handful of tokens, deterministic geometry in code.
- web-editor renders `TextShape` screen-space (fixed world height, Y-flip
  negated rotation, hidden below ~4 px).
- web-editor human faces of the same commands: a **Dimension tool** in the
  palette (`DIM` — the DIMLINEAR flow: two extension points, third click
  places the line and its side; the ghost previews the real entity
  geometry), a **`DIMAUTO`** command-line keyword (runs `DIM.AUTO` for the
  active level and logs `{removed, created}`), and a **live length readout**
  on the rubber band while drawing walls/lines — meters appear as you drag,
  before anything is committed.

## The mobile editor's automatic dimensions are the same rule, per view

`apps/editor` labels every wall and opening without anyone placing a dimension.
That is a **render pass**, not `DimensionEntity`: nothing is created, so there is
nothing to undo, sync or strip before export — golden decision 1 taken to its
limit, where even the entity is derived.

It applies the two-sided rule as **one setting for the whole plan**
(`EditorUi.measureMode`, `'outside' | 'inside'`) rather than per dimension,
because a phone has no room to bind a side to each label one at a time. Outside
is the default: a setting must not change the drawing the moment it exists.

Which face "inside" means is decided from the normal pointing away from the
plan's centre, so the file keeps one notion of outside instead of inventing a
second. Inside measures the face pointing **into** the plan and **draws the
dimension on that same side**: the two are one decision, because a clear width
printed out beyond the outer face describes a room from a place no tape can
reach. Outside rings the drawing; inside deliberately falls across it.

A clear width stops at a **face**, never at a centreline. A mitered corner
already cuts the inner face back to its neighbour's face, so the outline gives
that for free — but `WALL.RESOLVE` splits a wall wherever a partition tees into
it, and each half then runs to the junction _point_, which is the partition's
centreline. So each end is additionally set back by `h / |sin θ|`, the offset at
which the axis crosses the crossing wall's near face. At a miter that lands
exactly where the miter already was, which is why it applies unconditionally.
The tell that it was missing: three bays under one 5.70 m wall summing to
exactly 5.70, with two 0.30 m partitions standing in that span.

Three consequences worth knowing:

- The setback belongs to the **inner face only**. A partition tee'd into a wall
  stands on one side of it, so the far face runs past the junction untouched.
- A wall **between two rooms** takes its inner face from the plan's centroid,
  not from whichever room you tapped. Stable and deterministic; not always the
  face that particular reader wanted.
- Openings carry no faces, so a hole prints the same width in both modes — but
  it still moves inside with its host, or a window's number would sit on the
  opposite side of the wall from the wall's own.

The wall-measurements dialog asks `labelledWallLength()` for its prefill rather
than measuring again, because "the length of this wall" is no longer a property
of the wall — the same wall reads 6.30 or 5.70 — and a dialog offering to edit a
number different from the one on screen is worse than no dialog.

## Known V1 limitations

- **Stale on wall deletion** — a walls-mode dimension whose wall is erased
  renders empty instead of being cleaned up (no relation edge yet).
- **Walls-mode measures at the anchor `t`** — for non-parallel walls the
  value depends on where along wall A you anchor; that is what a "clear
  distance here" dimension means.
- **No dimension styles** — text height, tick size, offsets are constants;
  a style table can arrive with other annotation entities.
- **No chains/continued dimensions, no angular/radial** — linear aligned
  only.
- **`ENTITY.MOVE` does not move walls-mode dimensions** — they are bound to
  their walls, not to a location. Points-mode dimensions move normally.

## Deferred

Relation-backed references (dirty propagation + cascade delete);
dimension style table; grips (drag the offset); chained/baseline dimension
runs; door/window opening dimensions; associative auto-dims (regeneration
covers the need until then).


## Typing a length: what else moves (app-side, 2026-09-08)

Setting one wall's length is a geometry edit, and the plan has three coherent
answers to "what happens to everything joined to it". The choice lives in the
app (`apps/editor/src/editor/rooms.ts`), not here — core only ever moves the
grips it is told to.

- **push** — everything beyond the growing corner travels with it, keeping
  every length and angle it had. The building gets bigger.
- **absorb** — only the corner moves; whatever is immediately beyond gives up
  the difference by getting shorter. The footprint is unchanged.
- **alone** — nothing else moves at all and the junction comes apart. The
  honest outcome of lengthening one wall of a room and telling the others to
  stay put, and what a plan being CORRECTED wall by wall actually wants.

Which one applies is resolved by `resizeSpreadFor(reach, detachedMove)`. The
Settings toggle asks the outer question — does anything else move at all — and
only when it does does the footer's move-separately toggle answer the inner
one. The order matters: read the other way round, a footer toggle would
silently override a setting the user went into a sheet to choose.

None of the three ever rotates a wall it did not have to. Carrying is decided
by GEOMETRY — how far a point sits along the growth direction — never by
distance through the join graph, which is a property of the traversal rather
than of the drawing and sheared any room that straddled the boundary.


## Reproducing a surveyed plan (app-side, 2026-09-08)

Tracing a measured drawing is a different job from sketching one, and it needs
three things a sketch does not.

**A third reference: `center`.** Outside and inside both move when a wall's
thickness changes — and not only its OWN thickness: a wall's drawn extent is
lengthened by the miters at its ends, which are cut against the walls it meets,
so an outside dimension shifts when a wall you did not touch is made thicker.
The centreline is immune to all of it, which is why a survey quotes it. Typing
6.00 in centre mode puts the centreline at exactly 6.00; the same 6.00 in
outside mode means the drawn extent, and the centreline comes out at 5.85 with
a miter eating the difference. Both are right; only one is what a plan
dimensioned to the centimetre is asking for.

**A typed bearing.** `planWallRotate` turns a wall to an exact angle, holding
whichever end is joined — the same anchor a resize picks, so setting a length
and then an angle pivots about the same corner and the far end lands where the
two numbers together say. The bearing is always reported start → end: reporting
it from the anchored end would make the same wall read 23° or 203° depending on
a join it did not ask for, and a survey quotes one of those, not either.

**A typed position.** `moveWallStartTo` puts a wall's start corner at an exact
point by TRANSLATING the wall — it keeps the length and bearing it was given
and simply goes where it was told. That is what makes the three compose, and
why position is applied LAST of the three: length says how big, angle says
which way, and a translation is the only edit that can honour both while
putting the corner where it was asked for. Both boxes must read before either
is used, so a good x and a broken y cannot move a wall on an axis nobody was
editing.

Coordinates go through the same `parseLength` as every other field, so they
take the active unit, accept an explicit suffix that overrides it, and — unlike
every length here — may be negative or zero. A coordinate is a position, not a
size, and the origin is a perfectly good place for a corner.

**An angle magnet that gets out of the way.** The bearing snap used to be ±6°
around every 15°, capturing 12° of every 15 — four fifths of every bearing a
finger could ask for was rewritten, and a building with 23° and 67° walls could
not be drawn at all. There is no Shift key on a phone to escape with, so the
tolerance is now asymmetric: square bearings keep the generous 6°, the 15°
marks between them hold within 1.5°. Help where walls really are square,
without rewriting the angles on a plan that is not.

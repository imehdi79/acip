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

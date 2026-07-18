# Relations — Host/Attachment System

Status: **Decided** · Last updated: 2026-07-11

The heart of the semantic model. Canonical example: **a window on a wall**. Also powers:
finishes on wall faces, entities bound to levels, and (later) arrays linked to paths,
dimensions following geometry.

## What "window on a wall" actually requires

1. **Parametric placement.** The window's position is stored as
   _"on wall #42, at t=0.4 along its axis, sill offset 0.9m"_ — never as absolute
   coordinates. World position is **derived**. Move/stretch the wall → the window follows
   because its position is recomputed, not copied.
2. **The host is modified by its attachments.** A window cuts an opening: the wall's
   _effective_ geometry = base geometry − openings contributed by hosted entities
   (a `topology/` boundary-with-holes computation). See `getBaseGeometry` vs
   `getEffectiveGeometry` in the [Entity contract](../03-contracts/entity-contract.md).
3. **Lifecycle rules (cascade policies).** Delete the wall → cascade-delete hosted
   windows (default). Copy the wall → windows copy with it. Stretch the wall shorter than
   a window's position → violation to detect and surface.

## Mechanism

- `relations/` (Layer 2) maintains a **one-directional dependency DAG**: window depends
  on wall; wall never depends on window _dependency-wise_ (effective geometry is computed
  on read, not a graph edge).
- On change, dependents are marked **dirty** and re-evaluated in dependency order.
  Cycle detection required; no solver.
- Hosts expose **anchors** (`IHost.getAnchors()`): a wall provides its centerline curve
  and faces; a polyline region its interior; a circle its rim. Anything that can host
  declares _where_ things attach.
- Relation edits (`attach`/`detach`) go **through transactions** — undo restores the
  relationship, not just the shapes.
- Levels participate in the same machinery: a wall with `topLevelId: L2` recomputes when
  Level 2's elevation changes. Same DAG, same dirty propagation.

### Implementation notes (2026-07-11)

- **Recompute is pull-based**: derived geometry is evaluated lazily on read
  (`window.getBaseGeometry()` resolves its host through the graph;
  `wall.getEffectiveGeometry()` collects `IOpeningCutter` attachments). The dirty
  set from `collectDirty` drives spatial-index updates and the change event; no
  push/cache pass exists yet — add one only when profiling demands it.
- **Relation endpoints count as touched**: attach/detach marks both host and
  hosted dirty (a window snaps to its wall on attach).
- **Placement param `t` lives in the hosted entity's props**, not in
  `relation.params` (single update path through `tx.update`); the relation stores
  the anchor index. Revisit if a generic recompute pass ever needs relation-owned
  params.

## Explicitly NOT a constraint solver

A real parametric constraint solver (bidirectional: "keep these lines parallel and this
distance fixed, solve for everything") is enormously harder and **not needed**. Host
relations are strictly one-directional. `relations/` now; `constraints/` maybe never.
This distinction saves months — do not blur it.

## Why this matters for agents

_"Place a window every 3 meters along the north wall"_ is only a sane agent command if
walls and hosted placement exist as first-class concepts. A drawing of dumb lines is
nearly illegible to an LLM; a drawing with semantic relations is something an agent can
reason about.

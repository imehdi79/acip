# Levels & Views (Multi-Floor)

Status: **Decided** · Last updated: 2026-07-11

## Levels are first-class datums — day one

Not the AutoCAD way (layers named `FLOOR-01`, separate files). The Revit way: a **Level**
is a document object — a named horizontal datum with an elevation ("Level 2 @ +3.00m") —
and entities are *associated* with levels via `ILevelAware`, not drawn on them.

- A wall stores `baseLevelId + height` **or** `baseLevelId + topLevelId` — raising
  Level 2 makes every wall bound to it grow. This rides the same
  [relations](relations.md) recompute machinery (levels are just another dependency).
- Copy-floor-to-floor = duplicate entities, re-associate to the target level.
- Stairs and shafts are **cross-level relations** — levels are not isolated silos.
- Agents get vertical semantics: *"place the same window layout on floors 2–5"* is only
  expressible if floors exist as model objects.

Decided early because it is cheap now and brutal to retrofit — it touches the Entity
contract.

## The model/view split

Levels force it: **one document, many views**. A floor plan is not a drawing — it is a
**query**: "entities associated with Level 2."

- `views/` (Layer 3) defines `ViewDefinition` = filter + projection + display settings.
  - `PlanView(level)` — the primary editing view
  - `View3D` — collects derived meshes, **read-only in v1**
  - Later: sections/elevations are just another ViewDefinition with a cut plane
- **Viewports in web-editor render Views, never the raw document.**

### Implementation note (2026-07-11)

Level-unassigned entities (`baseLevelId: null`) are visible in **every** plan
view, not only the "all levels" view — friendlier while drawings mix
level-aware and plain drafting entities. Level store changes propagate dirty to
entities bound to that level (elevation change moves their 3D).

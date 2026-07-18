# Vision & Product Identity

Status: **Decided** · Last updated: 2026-07-11

## What this is

**AutoCAD + Revit + BIM**, on the web:

- **AutoCAD**: precise 2D drafting — snapping (OSNAP), trimming, command-line driven
  workflow, layers, blocks.
- **Revit**: _semantic_ building modeling — walls, windows, doors, levels, and types are
  first-class objects that know what they are and how they relate. A window is _hosted on_
  a wall, cuts an opening in it, and follows it when it moves.
- **BIM**: a data-rich model — materials, assembly layers, quantities — feeding a **live
  cost estimator**. The model is not a drawing; it is a priced description of a building.
- **AI agents**: independent packages (added later) that observe the model and operate on
  it through the same command API humans use. Example future agents: drafting from a
  prompt, auto-dimensioning, code compliance checking, cost optimization.

The identity in one phrase: **a cost-aware building modeler**. Every architecture decision
below exists to serve that identity — the semantic model exists so quantities can be taken
off; quantities exist so cost is live; semantics + commands exist so agents can reason and
act.

## What this is NOT

- **Not a dumb-lines CAD clone.** Plain geometry with no semantics cannot do quantity
  takeoff and is nearly illegible to LLM agents. We chose the harder, semantic path.
- **Not a 3D modeling application (v1).** No BRep kernel, no NURBS, no 3D booleans, no 3D
  editing. 3D is derived visualization only. See [2.5D strategy](../04-systems/2-5d-strategy.md).
- **Not a parametric constraint solver.** Host/attachment relations are a one-directional
  dependency DAG, not a bidirectional constraint network. See
  [relations](../04-systems/relations.md).
- **Individual tiles/bricks are never modeled as entities.** Finish regions are modeled;
  counts are computed by the estimator (area / tile size + waste factor).

## Confirmed long-term scope (deferred, but real)

- **IFC import/export** — confirmed coming; `io/` design must anticipate it.
- **editor-server** — persistence/collaboration; discussion deferred by user decision.
- **Multiple AI agent packages** — the plugin seam is designed for them from day one.

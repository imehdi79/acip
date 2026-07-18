# editor-core — Design Source of Truth

These documents capture the architecture decisions for `packages/editor-core` and its
satellite packages. They exist so that **any session — human or LLM — starts from the
same decisions instead of re-deriving them**. Read this index first, then the numbered
folders in order.

If you are an LLM: treat "Decided" items as settled — do not re-litigate them unless the
user explicitly reopens the topic. "Open" and "Deferred" items are fair game.

## What we are building (one sentence)

A web-based, **cost-aware building modeler** — AutoCAD's drafting precision + Revit's
semantic building model + BIM's data richness — with **AI agents as first-class citizens**
that arrive later as independent packages.

## Reading order

| Folder                                          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-vision](01-vision/vision.md)                | Product identity, what it is and is NOT                                                                                                                                                                                                                                                                                                                                                                                                      |
| [02-architecture](02-architecture/monorepo.md)  | Monorepo layout, [core layering](02-architecture/layers.md), [plugin seam](02-architecture/plugin-seam.md)                                                                                                                                                                                                                                                                                                                                   |
| [03-contracts](03-contracts/entity-contract.md) | The two keystones: [Entity contract](03-contracts/entity-contract.md), [Command/Transaction](03-contracts/command-transaction.md)                                                                                                                                                                                                                                                                                                            |
| [04-systems](04-systems/relations.md)           | [Relations](04-systems/relations.md), [Levels & views](04-systems/levels-and-views.md), [2.5D strategy](04-systems/2-5d-strategy.md), [Materials & types](04-systems/materials-and-types.md), [Wall joins](04-systems/wall-joins.md), [Spaces](04-systems/spaces.md), [Dimensions](04-systems/dimensions.md), [Slabs](04-systems/slabs.md), [Roofs](04-systems/roofs.md), [Finishes](04-systems/finishes.md), [Stairs](04-systems/stairs.md) |
| [05-packages](05-packages/estimator.md)         | [Estimator](05-packages/estimator.md), [AI agents](05-packages/ai-agents.md)                                                                                                                                                                                                                                                                                                                                                                 |
| [06-roadmap](06-roadmap/deferred.md)            | Deferred decisions and open questions                                                                                                                                                                                                                                                                                                                                                                                                        |

## The golden rules (non-negotiable invariants)

1. **The core is headless.** No DOM, no React, no canvas inside `editor-core`. It must run
   in Node, a Web Worker, or the server unchanged.
2. **The command bus is the only mutation path.** Humans, tools, and AI agents all change
   the document exclusively by dispatching commands. No direct entity mutation from outside.
3. **The 2D plan is the single source of truth.** 3D is derived, read-only output (v1).
   There is no 3D modeling kernel, deliberately.
4. **Anything not in `saveData()` is derived** and must be recomputable. This invariant
   powers undo, serialization, IFC export, and future collaboration.
5. **Class-based model layer, function-based math layer.** Entities/document/tools are
   classes; geometry/topology are pure functions over immutable value types.
6. **Extension happens through registries.** Entity types, commands, tools, snap providers,
   measurement rules — all registered, never hardcoded, so external packages (agents,
   estimator, domain packs) plug in without core knowing they exist.

## Status legend

- **Decided** — settled in design discussions (2026-07). Do not reopen casually.
- **Deferred** — intentionally postponed; the design leaves a slot for it.
- **Open** — known question with no answer yet.

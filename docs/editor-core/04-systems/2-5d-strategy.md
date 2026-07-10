# 2.5D Strategy — 2D Source of Truth, Derived 3D

Status: **Decided** · Last updated: 2026-07-11

## The decision

Of three options — pure 2D (too small), full 3D solid kernel (BRep/NURBS/3D booleans —
multi-year trap, the graveyard of ambitious CAD side projects), and **2.5D** — we chose
2.5D:

- The model is **semantic plan geometry + vertical data**: a wall is a 2D baseline +
  base level + height. All editing, snapping, trimming, and topology happen in **2D plan
  space** (Layer 1 stays 2D — roughly 10× less math than a 3D kernel).
- The 3D representation is **generated**: extrude the wall footprint, subtract window
  openings, triangulate (`geometry/mesh/`), hand meshes to a viewer.
- This is substantially what Revit itself does for buildings: a Revit wall *is* a
  baseline + height + profile; freeform 3D is the exception (roofs, massing), not the
  rule. 2.5D covers walls, windows, doors, floors, columns, rooms — the whole core domain.

## Consequences

- **3D is a view, not an editing space (v1).** `View3D` is read-only visualization. The
  WebGL/three.js viewer lives outside core (future `packages/viewer-3d`), consuming
  meshes the way agents consume commands. Core stays headless.
- Entities opt into 3D via the `IMeshable` capability (see
  [Entity contract](../03-contracts/entity-contract.md)); entities without it simply
  don't appear in 3D.
- Invalidation rides the existing [relations](relations.md) dirty propagation: wall
  moves → its mesh is dirty → View3D updates. No new machinery.

## Deliberately deferred

3D editing (dragging in the 3D view), sections/elevations as drawing views, sloped
roofs / freeform surfaces. Each has a natural landing slot later (sections = a
ViewDefinition with a cut plane; roofs can start as extrusions with a slope parameter).
**If freeform 3D modeling is ever genuinely needed, bolt on OpenCascade via WASM as an
island — do not rewrite the kernel.**

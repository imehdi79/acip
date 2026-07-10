# Materials, Type Catalog & Finishes

Status: **Decided** · Last updated: 2026-07-11

User requirement: *"attach tiles — or better, layers — to a wall."* Two distinct concepts
hide in that sentence; we want both, and they land in different places.

## 1. Assembly layers (type-level)

A wall is a *build-up*: 20cm block + 5cm insulation + 2cm plaster + 1cm tile. That
composition belongs to the **wall type**, not each instance:

- `document/types/` — the **type catalog**: a `WallType` holds ordered layers, each
  layer = material + thickness. Wall instances reference their type via `Entity.typeRef`.
- Change the type → every wall of that type updates (same recompute propagation).
- Yields: total wall thickness, per-layer hatching in plan view, per-material volumes for
  the estimator.

## 2. Surface finishes (instance-level)

*"Tile THIS bathroom wall, up to 1.2m height"* is one wall's business, not the type's.
This is **exactly the [relations](relations.md) machinery again**: a finish entity hosted
on a wall **face** (an anchor from `IHost.getAnchors()`), placement params = extent +
height, participating in recompute:

- stretch the wall → tiled area updates
- add a window → the opening subtracts from the tiled region (topology boundary-with-holes)

## Materials are first-class

What gets attached is not a mesh — it is a **material**. The mesh/texture is how a
material *looks in 3D*; the hatch pattern is how it looks *in plan*; the cost-per-m² is
how it looks *to the estimator*.

- `document/materials/` — material library: name, 2D hatch, 3D appearance, measurement
  hooks (unit, cost basis).

## Hard rule: never model individual tiles

Tile *pattern layout* (grout lines, edge cuts) is a rendering + estimation detail, not
model geometry. Model the **finish region**; the estimator computes tile counts from
area, tile size, and a waste factor. Ten thousand tile entities would kill performance
for zero benefit.

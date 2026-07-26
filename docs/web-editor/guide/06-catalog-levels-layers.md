# Catalog, levels & layers

[← Guide index](README.md)

These three side panels set up the *vocabulary* of your model: what things are
made of (Catalog), which storey they're on (Levels), and how they're organised
for visibility (Layers).

## Catalog — materials and assemblies

The **Catalog** panel has two parts.

### Materials
A material is one thing seen three ways: a look in 3D, a hatch in plan, and a
**cost basis** for the estimate. Each material has:

| Field | Meaning |
| --- | --- |
| **Color** | Its appearance (3D + swatches). |
| **Name** | What you call it ("Plaster", "Floor tile"). |
| **Cost code** | The key the **rate table** prices against (see [Quantities & cost](07-quantities-and-cost.md)). Editable inline. |
| **Unit** | How it's measured: `m³` (volume), `m²` (area), `m` (length), or `count`. Drives how quantities roll up. |
| **Coverage** | For `count` materials only — the m² one unit covers (e.g. a 0.3 × 0.3 m tile = 0.09), so tile counts derive from area. |

Add a material by name + cost code. Every new drawing seeds a starter set
(concrete block, insulation, plaster, screed, wall tile, floor tile, paint,
cement render…) so the takeoff works out of the box.

### Types (assemblies)
A **type** is a layered build-up — the reusable recipe an element is made of. A
wall type like *"Block 300 (20 + 5 + 5)"* stacks block + insulation + plaster;
a slab type stacks concrete + screed. Each layer is a **material + thickness**.

- Types are targeted at **wall**, **slab**, or **roof**.
- A wall/slab/roof that uses a type derives its **thickness** from the layer
  stack, and its cost splits across the layers, each measured in its own unit.
- New walls and slabs pick up the current type automatically; setting a raw
  thickness by hand (in the Select editor) drops the type for that element.

> Types vs. finishes: a **type** is the body of the element (structure +
> render); a **finish** is an extra surface material on one face or floor. See
> [Rooms & finishes](04-rooms-and-finishes.md).

## Levels — the storeys

**Levels** are the building's storeys, each at an **elevation** in meters. The
active level is chosen in the **status bar** (or the Levels panel):

- New walls, slabs, and dimensions are assigned to the **active level**.
- Choosing a level focuses the plan on that storey; **All** shows everything.
- Level-unassigned geometry bounds rooms on every level.
- Stairs run from a base level to the one above.

Add a level with a name and elevation; duplicate one to copy a storey's layout
upward.

## Layers — organising the drawing

**Layers** are the classic CAD organiser — a way to group elements and control
their visibility, independent of storeys. For each layer you can:

| Control | Effect |
| --- | --- |
| **Active** | New geometry lands on the active layer. |
| **Show / hide** | Toggles the layer's visibility in the plan. |
| **Lock / unlock** | A locked layer can't be selected or edited. |
| **Color** | The layer's display color. |

Add and remove layers as needed; there's always a default layer.

---

Next: [Quantities & cost →](07-quantities-and-cost.md)

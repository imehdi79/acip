# Quantities & cost

[← Guide index](README.md)

This is why the model is semantic: because the app knows *what* each element is,
it can measure and price it. The **Quantities** panel recomputes on **every
change** — draw, edit, finish, or mark for demolition, and the numbers move.

## Quantities (takeoff)

The top of the panel is the raw takeoff:

- **Walls** — count, total **length**, net **face area** (elevation area minus
  openings), and net **volume**.
- **Windows** and **Doors** — counts.
- **Materials** — a rollup of every material in the model, each in its own unit:
  m³ for volumes, m² for areas, m for lengths, and a **count** for tiles
  (derived from area via the tile's coverage).

Openings are already deducted from wall areas/volumes here, and typed elements
are split across their assembly layers.

## Rooms breakdown

One row per detected room: editable **name**, **area**, **perimeter**, and a
**floor cost** from the live rate table. Click a row to select and zoom to that
room. A total floor area and floor-finish cost close the section. (Shared wall
assemblies stay in the document-wide Cost total, not split per room.)

## Cost (the BOQ)

The **Cost** section turns quantities into money — a bill of quantities, one
line per **cost code**, priced against the live rate table. It updates per
change, so you can watch the price tick as you draw.

### The Demolition / Rebuild split
When the model contains demolition work, the BOQ reads like a renovation quote:

- a **Demolition** section (strip-out finishes + openings to remove) with its
  **subtotal**,
- a **Rebuild** section (new finishes, walls, slabs, openings) with its
  **subtotal**,
- the grand **Total**.

Demolition lines are the ones whose cost code starts with `demo-` (e.g.
`demo-wall-tile`, `demo-window`); everything else is rebuild.

### Solid walls (توپر)
A checkbox at the top of the Cost section: **"Solid walls (openings priced
separately)"**. With it on, walls are measured **solid** — openings are **not**
deducted from wall volume — and each window/door instead carries its **own** line
item (a supply/install unit). Use it when your convention prices walls gross and
doors/windows as separate products. With it off, openings are deducted from the
wall in the usual way.

## How pricing works

1. Each element's quantity is attributed to a **cost code** — a material's cost
   code, or a generic fallback (`wall-volume`, `slab-volume`, `finish-area`…) for
   untyped elements.
2. Demolition items map to `demo-<cost code>`; openings to `window` / `door`
   (or `demo-window` / `demo-door`).
3. The **rate table** supplies a unit cost per code; quantity × rate = amount.
4. Measurement **rules** (policy) adjust things — by default a **5 % waste**
   allowance on quantities and a **small-opening rule** (openings under 0.5 m²
   aren't deducted). "Solid walls" adds a rule that deducts no openings at all.

A code with a quantity but **no rate** shows as `… (no rate)` and adds nothing to
the total — a prompt to publish that rate.

## Where rates come from

Rates are **data, not code** — volatile and regional. The app ships a **demo
rate table** (in EUR) covering the seeded catalog, demolition strip-outs, and
opening install/removal. If an **editor server** is configured, the office's
published rates are fetched and merged over the demo table, so publishing new
rates reprices open editors. You control which cost code a material prices
against by editing its **cost code** in the [Catalog](06-catalog-levels-layers.md).

The mobile app surfaces the same takeoff + BOQ as a floating **Estimate** sheet.

---

Next: [AI assistant →](08-ai-assistant.md)

# Rooms & finishes

[← Guide index](README.md)

## Rooms are found automatically

You never draw a room — you **enclose** one. As soon as walls form a closed
loop, the app detects the room, computes its **net area** (to the inner wall
faces) and perimeter, and makes it addressable for floors, finishes, and
schedules. Move a wall and the rooms update instantly.

### Room marks and naming
Turn on **Marks** in the top bar to label things on the plan: walls (`W3`),
doors (`D1`), windows (`WN2`), and rooms (`R1`, `R2`…). Room marks are
**editable** — click a room's `R#` label and type a real name ("Kitchen",
"WC", "Bathroom"). The same names appear in the **Rooms** list in the side
panel, and vice-versa.

Names are remembered per room by its boundary walls, so a name sticks as long as
the room's walls do. (Reshape the room enough and it may need renaming.)

### The Rooms list (side panel)
Under **Quantities → Rooms** you get one row per detected room:

- an editable **name**,
- its **area** and **perimeter** (in the active unit),
- a **per-room floor cost** from the live rate table,
- click a row to **select** that room and **zoom** to it.

Select a room and you can also edit its dimensions numerically on the plan — see
[Drawing tools → editing](02-drawing-tools.md).

## Finishes — materials on surfaces

A **finish** is a material applied to one surface:

- a **wall face**, as a band — you control how high it goes (`sill` to `top`
  height) and how far along the wall it runs;
- a **slab**, covering its footprint — the **top** is the floor finish, the
  **bottom** is the ceiling.

Finishes follow their host (stretch the wall and the finish restretches) and are
**priced by the material's unit** — a `count` tile material yields tile counts,
an `m²` paint yields area, an `m³` screed yields volume. Openings are subtracted
from a wall finish automatically: add a window and the tiled area drops by the
overlap. On the plan, finishes draw as a dashed band hugging the wall face (or a
footprint outline on a slab).

> **Stacked finishes.** Each finish is a single material. "Plaster **and**
> paint" is two finishes on the same face (plaster full height + paint full
> height); "tile to 1 m, plaster above" is a tile band `0–1 m` plus a plaster
> band `1 m–top`. Stacking bands this way is exactly how the wet-room and
> kitchen schemes are modelled.

### Quick finishing: the AUTO macros
Type these in the command line to finish everything on the active level at once.
Each is **idempotent** — re-running replaces what it made before, so tweak and
re-run freely.

| Command | What it does |
| --- | --- |
| `SLABAUTO` | Creates a floor **slab** for every detected room. Run this first if you want floor finishes. |
| `FLOORAUTO` | Applies a floor finish to every slab (tells you to run `SLABAUTO` first if there are none). |
| `FINISHAUTO` | Tiles every room-facing wall face up to 1.2 m with the catalog's wall tile. |
| `ROOFAUTO` | Builds a roof over each closed building outline. |
| `DIMAUTO` | Dimensions the plan. |

### Precise, per-surface finishing
For exact schemes — "three kitchen walls in plaster, one in cement + tile", "WC
walls tiled to 1 m then plaster to the ceiling" — the easiest route is the
**estimator assistant**: describe the scheme and it proposes the finishes for
you to confirm (see [AI assistant](08-ai-assistant.md)). Power users can also
dispatch the underlying commands (`FINISH.ADD`, `FLOORFINISH.ADD`) with explicit
`sillHeight` / `topHeight` bands.

Everything a finish adds shows up live in the **Quantities**, **Materials**, and
**Cost** panels — see [Quantities & cost](07-quantities-and-cost.md).

---

Next: [Demolition & phases →](05-demolition-and-phases.md)

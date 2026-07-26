# Getting started

[← Guide index](README.md)

## Starting a drawing

When you open the app for the first time (or click **New**), the **starter**
modal offers a few ways to begin:

| Choice | What it does |
| --- | --- |
| **Square room / Rectangular room / L-shaped room / Two rooms** | Drops a ready-made layout you can edit right away. The thumbnail is the real wall geometry — what you see is what you get. |
| **Free draw** | Starts a blank canvas with the sketch tool active, so you can draw walls by hand. See [Free draw & underlay](03-freedraw-and-underlay.md). |
| **Blank** | An empty canvas. |

**New** always replaces the current drawing. To *add* a preset room to an
existing plan instead, use the "Add a room" entry from the side panel — it drops
the room next to your walls as a single undo step.

Every new drawing comes with a small **demo catalog** already loaded (a wall
assembly, a slab assembly, tile, paint, cement…), so the takeoff has something
to measure against immediately. See [Catalog](06-catalog-levels-layers.md).

## Opening and saving files

The native format is a `.acip.json` file that holds the whole model — geometry,
catalog, levels, layers, and relations.

- **Save** downloads the current drawing as `drawing.acip.json`.
- **Open** loads an `.acip.json` file back in. Opening replaces the current
  drawing and resets the active level to **All**.

### Autosave

Your work is **autosaved to the browser** (local storage) a moment after every
change, and restored automatically the next time you open the app on that
device. Autosave is a safety net, not a substitute for **Save** — it lives only
in that one browser. Use **Save** to keep a real file or share it.

## Moving around the canvas

| Action | Mouse | Touch |
| --- | --- | --- |
| **Pan** | Drag with the **middle mouse button** | Drag with **one finger** |
| **Zoom** | **Mouse wheel** (toward the cursor) | **Pinch** with two fingers |
| **Zoom to fit** | Selecting a room from the Rooms list frames it; a fresh import frames the whole drawing | — |

The **status bar** at the bottom shows your live cursor position, the snap
state (`OSNAP END MID`), the active **Level**, and the display **unit**.

## Units

The model is always in **meters**. The unit picker in the status bar changes
only how lengths are *shown and typed*: **m**, **cm**, or **mm**. Areas are
always shown in m² and volumes in m³.

## Undo, redo, and delete

| Action | How |
| --- | --- |
| **Undo** | Toolbar **Undo**, `Ctrl+Z`, or type `UNDO` / `U` |
| **Redo** | Toolbar **Redo**, `Ctrl+Y` or `Ctrl+Shift+Z`, or type `REDO` |
| **Delete selection** | Select, then press `Delete` or `Backspace` (or type `ERASE` / `E`) |

Undo/redo covers every change — drawing, editing, finishes, demolition marks,
catalog edits — because everything flows through one command history.

## The command line

The bar at the bottom accepts short typed commands (case-insensitive) and prints
an activity log above it. Type a tool name to switch tools (`WALL`, `DOOR`…), or
run a one-shot action (`SLABAUTO`, `DIMAUTO`, `ERASE`, `UNDO`). The full list is
in the [Reference](09-reference.md).

---

Next: [Drawing tools →](02-drawing-tools.md)

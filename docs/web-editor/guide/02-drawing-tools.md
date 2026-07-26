# Drawing tools

[← Guide index](README.md)

Tools live in the **tool palette** on the left edge. Activate one by clicking
its icon, or by typing its name in the command line (`WALL`, `DOOR`, `DIM`…).
The active tool is highlighted. Most drawing tools stay active so you can place
several in a row; press `Esc` or switch to **Select** when you're done.

Common flow while drawing:

- **Click** to place each point; snapping pulls the cursor to nearby geometry.
- **Type a number** to set an exact length (see Dynamic input below).
- **`Enter`** confirms · **`Esc`** cancels the current operation.

## Dynamic input (typing exact lengths)

While a draw tool is active and you've started a segment, just **type a number**
— a small chip follows the cursor showing the length, and `Enter` places the
point at exactly that distance along the direction you're aiming. `Backspace`
edits the number. This is the fastest way to draw to precise dimensions: aim in
a direction, type `3.5`, press `Enter`. The number is in the active display unit
(m / cm / mm).

## Snapping

The cursor snaps to meaningful points on existing geometry — wall **endpoints**
and **midpoints**, corners, and opening centers — so things connect cleanly. A
yellow marker shows the active snap; the status bar shows `OSNAP END MID`.
Snapping works for both mouse and touch (with a slightly larger reach on touch).

## Select and edit

The **Select** tool is the default and the one you return to for editing.

- **Click** an element to select it · **Shift-click** to add/remove ·
  **`Esc`** clears the selection.
- **Box select** on empty space: drag **left → right** for a *window* box
  (selects only fully-enclosed elements), **right → left** for a *crossing* box
  (selects anything the box touches).
- **Move**: drag a selected element; a ghost preview follows until you drop it.
- **Stretch**: drag an element's **grips** (endpoints/corners) to reshape it.
  Walls keep their openings and rejoin neighbours as you drag.

### Editing rooms and walls by the numbers

When your selection is a single opening, a wall, or a whole rectangular room,
inline editors appear so you can type exact values instead of dragging:

- **Rectangular room** — drag any corner to resize the whole room at once, or
  edit its width/length dimensions directly on the plan.
- **Wall(s)** — set **height** and **thickness** in meters. (A wall that uses a
  typed assembly derives its thickness from the build-up; setting thickness by
  hand switches it to a plain wall — see [Catalog](06-catalog-levels-layers.md).)
- **Window / Door** — set its **width** and slide its **position** along the
  host wall.

## The architectural tools

### Wall
Draws load-bearing/partition walls as a **chained** run: click the start, click
each corner, and the tool keeps going until you press `Esc` or `Enter`. New
walls take the current **wall type** (assembly) and the active **Level**. Set
**height** and **thickness** afterward via the Select editors.

### Window and Door
These are **hosted openings** — click on a wall to drop them in; they cut the
opening automatically and slide along the wall when moved. A window carries a
sill height; a door goes to the floor with a swing arc. Resize/reposition via the
Select editors.

### Slab
Draws a floor **slab** as a closed polygon footprint — click each corner, close
the loop. Slabs carry a thickness (or a slab assembly). To floor every detected
room in one step instead, use **`SLABAUTO`** (see
[Rooms & finishes](04-rooms-and-finishes.md)).

### Stair
Places a **stair** flight between two levels (base = active level, top = the next
level up, or a default flight when there's only one storey).

### Dimension
Adds a **dimension** annotation measuring between points or along walls. To
dimension the whole plan automatically, use **`DIMAUTO`**.

## The drafting primitives

For reference geometry that isn't a building element:

| Tool | Draws |
| --- | --- |
| **Line** | A straight segment (chained — keep clicking for connected segments). |
| **Circle** | A circle from center + radius. |
| **Arc** | An arc. |
| **Polyline** | A connected multi-segment polyline. |

These are plain geometry (they don't take part in the takeoff) — useful for
setting-out lines, notes, and tracing.

---

Next: [Free draw & underlay →](03-freedraw-and-underlay.md)

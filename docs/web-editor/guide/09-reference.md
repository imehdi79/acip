# Reference

[← Guide index](README.md)

## Command line

Type these in the bar at the bottom (case-insensitive). Tool commands switch the
active tool; the rest run once.

| Command | Aliases | Action |
| --- | --- | --- |
| `LINE` | `L` | Line tool |
| `CIRCLE` | `C` | Circle tool |
| `ARC` | `A` | Arc tool |
| `POLYLINE` | `PLINE`, `PL` | Polyline tool |
| `WALL` | `W` | Wall tool |
| `WINDOW` | `WIN` | Window tool |
| `DOOR` | `D` | Door tool |
| `SLAB` | | Slab tool |
| `STAIR` | | Stair tool |
| `DIM` | | Dimension tool |
| `SLABAUTO` | | Floor every detected room with a slab |
| `FLOORAUTO` | | Floor finish on every slab (run `SLABAUTO` first) |
| `FINISHAUTO` | | Tile every room-facing wall face up to 1.2 m |
| `ROOFAUTO` | | Roof over every building outline |
| `DIMAUTO` | | Auto-dimension the plan |
| `ERASE` | `E` | Delete the current selection |
| `UNDO` | `U` | Undo |
| `REDO` | | Redo |

The `…AUTO` commands are idempotent — re-running replaces what they made before.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl` + `Z` | Undo |
| `Ctrl` + `Y` — or `Ctrl` + `Shift` + `Z` | Redo |
| `Delete` / `Backspace` | Delete the selection |
| `Esc` | Cancel the current draw / clear selection |
| `Enter` | Confirm the current operation |
| `0`–`9`, `.`, `Backspace` | **Dynamic input** — type an exact length while a draw tool is active |
| `Shift` + click | Add/remove from the selection |

## Mouse & touch

| Action | Mouse | Touch |
| --- | --- | --- |
| Pan | Middle-button drag | One-finger drag |
| Zoom | Wheel (toward cursor) | Two-finger pinch |
| Select box (window) | Drag left → right | — |
| Select box (crossing) | Drag right → left | — |

## Glossary

- **Level** — a storey, at an elevation in meters. New geometry lands on the
  active level.
- **Layer** — a visibility/organisation group (show/hide, lock, color),
  independent of levels.
- **Material** — a costed substance with a unit (m³/m²/m/count) and a cost code.
- **Type (assembly)** — a layered build-up of materials (e.g. block + insulation
  + plaster) applied to a wall, slab, or roof.
- **Finish** — a single material on one surface: a wall-face band or a slab
  top (floor) / bottom (ceiling).
- **Phase** — **new** (build) or **demolish** (strip-out). Splits the BOQ into
  Rebuild and Demolition.
- **Room (space)** — a region enclosed by walls, detected automatically; named
  via room marks.
- **Mark** — an on-plan label: `W3` (wall), `D1` (door), `WN2` (window), `R1`
  (room).
- **Takeoff / Quantities** — the measured amounts (lengths, areas, volumes,
  counts) derived from the model.
- **BOQ (bill of quantities)** — the priced lines, one per cost code.
- **Cost code** — the key that links a material/element to a unit cost.
- **Rate table** — the cost data (unit costs per code); demo rates ship with the
  app, real rates come from the editor server.
- **Solid walls (توپر)** — measuring walls gross (no opening deduction), with
  doors/windows priced as separate items.
- **Underlay** — a reference plan image shown under the model for tracing (not
  saved with the document).

---

[← Back to the guide index](README.md)

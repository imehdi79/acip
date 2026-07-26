# acip web-editor — User Guide

The **acip editor** is a browser-based, cost-aware building modeler. You draw a
plan the way you would in a CAD tool — walls, doors, windows, slabs, stairs —
but every element is *semantic*: the app knows a wall is a wall, that a window
cuts a hole in it, and which room a surface faces. That knowledge powers live
**quantity takeoff** and a **bill of quantities (BOQ)** that reprices as you
draw, a renovation workflow (demolition vs. rebuild), and an optional AI
assistant that can draft and estimate for you.

This guide is task-oriented: it tells you how to *use* each feature. For how the
app is built, see the design docs one level up in
[docs/web-editor](../README.md).

## The screen at a glance

```
┌───────────────────────────────────────────────────────────────┐
│  Top bar:  New · Open · Save │ Undo · Redo │ Marks · Demolition │
│            · Underlay │ Plan · 3D                               │
├──────┬──────────────────────────────────────────┬─────────────┤
│ Tool │                                          │  Panels      │
│ pal- │                                          │  · Layers    │
│ ette │              Drawing canvas              │  · Levels    │
│ (left│             (Plan or 3D view)            │  · Catalog   │
│ edge)│                                          │  · Quantities│
│      │                                          │    / Cost    │
├──────┴──────────────────────────────────────────┴─────────────┤
│  Command line  (type LINE, WALL, SLABAUTO, ERASE …)            │
├───────────────────────────────────────────────────────────────┤
│  Status bar:  cursor X,Y │ OSNAP │ Level picker │ unit (m/cm/mm)│
└───────────────────────────────────────────────────────────────┘
```

- **Top bar** — file actions, undo/redo, the **Marks** and **Demolition**
  overlays, the **Underlay** loader, and the **Plan / 3D** view tabs.
- **Tool palette** (left edge) — the drawing tools: Select, Free draw, Line,
  Circle, Arc, Polyline, Wall, Window, Door, Slab, Stair, Dimension.
- **Canvas** — the plan (2D) or the model (3D). Pan, zoom, snap, and draw here.
- **Panels** (right) — Layers, Levels, the material/assembly Catalog, and the
  live **Quantities + Cost** takeoff.
- **Command line** (bottom) — type short commands and read the activity log.
- **Status bar** — live cursor coordinates, the snap indicator, the active
  **Level**, and the display **unit** (m / cm / mm).

On a phone the panels collapse into a drawer (the ☰ menu button), the estimate
opens as a floating sheet, and the AI assistant is a chat bubble.

## Where to start

| If you want to… | Read |
| --- | --- |
| Open the app, pick a starting layout, save your work | [Getting started](01-getting-started.md) |
| Draw and edit walls, openings, slabs, stairs, dimensions | [Drawing tools](02-drawing-tools.md) |
| Sketch by hand or trace over a plan image | [Free draw & underlay](03-freedraw-and-underlay.md) |
| Name rooms and apply plaster / paint / tile finishes | [Rooms & finishes](04-rooms-and-finishes.md) |
| Model a renovation — strip-out vs. rebuild | [Demolition & phases](05-demolition-and-phases.md) |
| Set up materials, wall build-ups, storeys, layers | [Catalog, levels & layers](06-catalog-levels-layers.md) |
| Read the takeoff and the priced BOQ | [Quantities & cost](07-quantities-and-cost.md) |
| Let the AI assistant draft or estimate | [AI assistant](08-ai-assistant.md) |
| Look up a command or keyboard shortcut | [Reference](09-reference.md) |

## Core ideas in one minute

- **Everything is meters.** The model is always in meters; the unit picker only
  changes how lengths are *displayed* (m / cm / mm).
- **Draw once, price live.** Because elements are semantic, the Quantities and
  Cost panels recompute on every change — drag a wall and the numbers move.
- **Rooms are derived, not drawn.** Enclose an area with walls and the app finds
  the room automatically; you can name it, floor it, and finish its walls.
- **Types are reusable build-ups; finishes are per-surface.** A wall *type* is a
  layered assembly (block + insulation + plaster); a *finish* is a material on
  one face or floor (tile up to 1 m, paint to the ceiling).
- **Two phases: new and demolish.** Mark existing tile, floor, or windows for
  removal and the BOQ splits into a **Demolition** section and a **Rebuild**
  section — the renovation quote reads top-to-bottom.

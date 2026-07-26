# Demolition & phases

[← Guide index](README.md)

The app models **renovation**, not just new build. Every finish and every
opening carries a **phase**:

- **new** — work to build: supply and install (the default for anything you
  draw).
- **demolish** — existing fabric to **remove**: priced as a strip-out, not an
  install.

The guiding idea is *"demolition is finish in reverse"*: a demolition item
measures the **same surface** as the finish it removes, but bills against a
removal rate instead of a supply rate.

## The Demolition overlay

Demolition items are hidden on the plan until you turn on **Demolition** in the
top bar — so your build drawing stays uncluttered. With it on, demolish-phase
work is drawn in a **warning red** so you can see exactly what's being torn out.
The button is a simple show/hide toggle; it doesn't change the model.

## Full vs. partial demolition

Because a demolition item is just a finish with `phase = demolish`, its **band**
controls how much comes off — this is the difference between full and partial:

| You want to… | Model it as |
| --- | --- |
| **Strip a whole wall face** (all its tile/plaster) | A demolish finish covering the full face (full height, full length). |
| **Strip part of a wall** — e.g. remove tile only up to 2 m | A demolish finish band `0 – 2 m`; above 2 m is untouched. |
| **Demolish a floor** — lift the floor tiles of a room | A demolish finish on that room's **slab top**. |
| **Remove a window or door** (no replacement) | Mark the opening's phase **demolish** — it becomes a removal line and shows on the demolition overlay. |

There is no separate "delete wall as demolition" — removing structural walls is
still a normal edit (delete the wall). Demolition here is about **finishes and
openings**: tile, plaster, floors, and windows/doors that come out before the
rebuild.

## How to mark something for demolition

Marking phase is done through the **estimator assistant** or the command bus,
not a palette tool:

- **Estimator assistant** — describe it in plain language: *"demolish the
  kitchen floor tiles"*, *"strip the wall tile up to 2 m and re-render in
  cement"*, *"remove the bathroom windows"*. It proposes the demolition (and any
  rebuild) for you to confirm. See [AI assistant](08-ai-assistant.md).
- **Commands** (power users) — a demolish finish is `FINISH.ADD` /
  `FLOORFINISH.ADD` with `phase: "demolish"`; flipping an existing finish or
  opening is `PHASE.SET { ids, phase: "demolish" }`.

## Demolish, then rebuild

A renovation is two passes over the same surfaces:

1. **Demolish** the existing finish (strip-out line).
2. **Rebuild** with a new finish (`phase = new`) — e.g. remove old tile, then
   re-render in cement and re-tile.

Both live in the model at once. The **Cost** panel reads the quote the way a
contractor writes it — a **Demolition** section (with its subtotal) first, then
a **Rebuild** section (with its subtotal), then the grand **Total**. See
[Quantities & cost](07-quantities-and-cost.md).

---

Next: [Catalog, levels & layers →](06-catalog-levels-layers.md)

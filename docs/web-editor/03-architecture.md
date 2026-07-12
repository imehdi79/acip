# App Architecture — Session, Viewport, Input, State

Status: **Decided** · Last updated: 2026-07-11

## Session ownership

ONE `EditorSession` per editor instance, created once (React context with a
lazy initializer), never recreated on re-render. React renders the chrome;
the session and its document live outside the React render cycle.

## Persistence (Decided 2026-07-12)

Open/New replace the document **in place** (`session.open(data)` /
`session.newDocument()` → core `_reset` + `loadDocumentInto` + one `load`
change event) — the doc instance never changes, so the imperative viewport,
tools, and agent keep their references; everything re-reads on the load
event. Save downloads `drawing.acip.json` (the native `DocumentData`
format). Autosave: debounced 500 ms to `localStorage` on every change,
restored at session creation *before* the demo catalog seeds (a restored
document keeps its own catalog). Consequence: anything holding ids across
an open (active level, seeded wall type) must resolve live from the doc —
the wall tool looks its type up per use.

## The viewport is an imperative island

`viewport2d-view.tsx` mounts two canvases, subscribes **directly** to
`doc.events` / selection / camera changes, and redraws on requestAnimationFrame.
It never re-renders through React state. Rules:

- Base canvas redraw triggers: document change event, camera change, selection
  change, resize (ResizeObserver + devicePixelRatio).
- Overlay canvas redraw triggers: pointer move (snap marker, rubber band),
  overlay-state change from tools.
- Line weights divide by scale so they stay zoom-independent.

## Camera (`Viewport2D`)

Presentation state, so it lives in the app, not core: core's `ViewDefinition`
says WHAT you see (Level 2's entities); the camera says FROM WHERE. World is
Y-up (CAD convention), screen is Y-down — the flip lives in exactly one place,
the camera transform. Wheel = zoom at cursor; middle-drag (or space+drag) = pan.

## Input pipeline — one straight line

```
DOM pointer event
  → world coords            (Viewport2D)
  → snap                    (core SnapEngine; snapped point wins)
  → ToolInputEvent          (core's abstract type — no DOM beyond this point)
  → active Tool             (ToolManager)
  → tool dispatches command (session.dispatch → command bus)
```

The command line is the same pipeline minus the pointer: parse text →
`session.dispatch`. Keyboard: Delete = erase selection, Escape = cancel tool /
clear selection, Ctrl+Z / Ctrl+Y = undo/redo — all through the session, never
through ad-hoc document access.

## React state sync (chrome only)

Panels and status bar subscribe via small external stores
(`useSyncExternalStore` wrappers):

- document revision counter (bumped per change event) — properties/layers panels
- selection list — properties panel, erase actions
- cursor world coords — status bar (rAF-throttled)
- tool prompt + message log — command line
- active view tab, active tool id — top bar / palette

No global state library until these outgrow it.

## First slice (implemented)

Shell layout + `Viewport2D` + base/overlay canvases + SelectTool + LineTool
(snap + rubber band + chained placement) + command line (LINE / ERASE / UNDO /
REDO) + undo/redo + panels skeleton + Three.js tab (grid + orbit; meshes appear
when the first `IMeshable` entity lands). Deferred: window/crossing selection,
grips, dashed linetypes, print, level switching UI (needs level-aware entities).

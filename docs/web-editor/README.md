# web-editor — Design Source of Truth

How `apps/web-editor` renders and drives `@acip/editor-core` in the browser.
Companion to [docs/editor-core](../editor-core/README.md) — read that first; the
core's golden rules (headless core, command-bus-only mutation, views not raw
document) bind everything here.

| File | Contents |
| --- | --- |
| [01-rendering-stack.md](01-rendering-stack.md) | Canvas 2D (not Konva), Three.js (not R3F) — decisions + rationale |
| [02-layout.md](02-layout.md) | The editor shell layout and component inventory |
| [03-architecture.md](03-architecture.md) | Session ownership, imperative viewport island, input pipeline, state sync |
| [04-agent.md](04-agent.md) | Drafter prompt box, API key handling, browser-direct caveat |

## The golden rules of the app layer

1. **The DOM layer is dumb.** Picking, snapping, and selection belong to
   editor-core (`hitTest`, `SnapEngine`, `SelectionSet`). The app translates DOM
   events to world coordinates and forwards them — it never decides what was hit.
2. **React is never in the pointer-move hot path.** The viewport is an
   imperative island subscribing directly to document events; React renders the
   chrome around it.
3. **Every mutation goes through `session.dispatch(...)`** — the command line,
   tools, keyboard shortcuts, and panels all converge on the command bus.

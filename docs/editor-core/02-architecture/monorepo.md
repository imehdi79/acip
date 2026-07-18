# Monorepo Layout

Status: **Decided** · Last updated: 2026-07-11

Nx monorepo. Current and planned projects:

```
apps/
  web-editor/          # React + Vite shell: canvas, panels, command line UI
  editor-server/       # persistence, collaboration, agent host  (DEFERRED — not designed yet)
  saas/                # marketing / account app
packages/
  editor-core/         # the headless engine — see layers.md
  ui/                  # shared React components
  editor-sdk/          # LATER: thin, stable API surface for external packages
  estimator/           # LATER: quantity takeoff + BOQ + cost  (see 05-packages/estimator.md)
  viewer-3d/           # LATER: WebGL/three.js viewer consuming derived meshes
  agents/*             # @acip/agent-* packages — first landed: agents/drafter
                       # (NL → commands, 2026-07-12); later: dimensioning, compliance…
```

## Dependency rules

- `editor-core` depends on **nothing** in the workspace (headless, standalone).
- `web-editor` depends on `editor-core` + `ui`; it owns the actual Canvas/WebGL renderer
  implementations behind core's rendering interface.
- Future external packages (`estimator`, `agents/*`, `viewer-3d`) depend on **`editor-sdk`
  interfaces only, never on core internals** — this is what lets core refactor freely
  while agent packages stay compatible. Until `editor-sdk` exists, `editor-core`'s curated
  `index.ts` _is_ the SDK contract; export deliberately, never `export *`.

## Housekeeping

- ~~Rename `@ecore` → `@acip/editor-core`~~ — done 2026-07-11.

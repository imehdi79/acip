# Rendering Stack

Status: **Decided** · Last updated: 2026-07-11

## 2D: plain Canvas 2D immediate mode — deliberately NOT Konva

Konva was considered and rejected. Its value proposition — retained scene graph
with built-in hit detection and shape events — conflicts with the core
architecture on two counts:

1. **Duplicated, competing hit-testing.** editor-core already owns picking
   (`entity.hitTest` with world-space tolerance, spatial index, `SnapEngine`,
   `SelectionSet`) so that agents, tests, and the server see identical behavior
   to the mouse. Konva's pixel-based shape events would bypass the command-bus
   discipline and know nothing about OSNAP.
2. **Mirror-tree sync.** A retained scene graph must be kept in sync with the
   document (create/update/destroy Konva nodes on every change event). Our data
   flow is already immediate-mode: change event → `buildDisplayList()` → clear
   canvas → replay paths under one world-to-screen `ctx.setTransform`.

Immediate-mode Canvas 2D is also the right performance profile for CAD content:
thousands of thin segments, zoom-independent line weights (`width / scale`),
dashed linetypes, grid, snap markers.

**Escape hatch if we ever hit a wall (50k+ entities): WebGL2 line batching
behind the same `Renderer` interface — not Konva.**

## 3D: plain imperative Three.js — deliberately NOT react-three-fiber

The 3D view is read-only visualization consuming `Mesh3D` (positions + indices)
from `IMeshable` entities — a 1:1 map onto `THREE.BufferGeometry`. Three.js +
OrbitControls is the choice.

R3F is rejected for the same mirror-tree reason: our scene derives from core
change events imperatively ("wall dirty → update its BufferGeometry"), not from
React state. Keep all Three.js code in one isolated `Viewer3D` component so the
planned `packages/viewer-3d` extraction is a file move.

## Two stacked canvases in the 2D viewport

- **Base canvas** — the drawing. Redraws on document/selection/camera changes.
- **Overlay canvas** — snap markers, rubber-band preview, grips. Redraws per
  pointer-move. Dragging never repaints the whole drawing.

## Dependencies

`three` (+ `@types/three`) is web-editor's only new runtime dependency.
`@acip/editor-core` resolves to source in dev via the `@acip/source` exports
condition (`resolve.conditions` in vite config) — no prebuild step.

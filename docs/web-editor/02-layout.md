# Editor Shell Layout

Status: **Decided** · Last updated: 2026-07-11

Classic CAD shell. The command line is NOT optional chrome — it is the human
face of the command bus, the app's identity.

```
┌─────────────────────────────────────────────────────────────┐
│ TopBar: file · undo/redo · view tabs (Plan L1 | Plan L2 | 3D)│
├──────┬───────────────────────────────────────────┬──────────┤
│ Tool │                                           │ Panels   │
│ Pal- │           VIEWPORT                        │ ─ Props  │
│ ette │   (Canvas2D plan view  /  Three.js 3D)    │ ─ Layers │
│ line │                                           │ ─ Levels │
│ move │   overlay canvas: selection grips,        │ ─ Types/ │
│ trim │   snap markers, tool preview (rubber band)│   Mat.   │
├──────┴───────────────────────────────────────────┴──────────┤
│ CommandLine:  > LINE ↵   (prompts, history, autocomplete)   │
├─────────────────────────────────────────────────────────────┤
│ StatusBar: 12.40, 3.75 │ OSNAP END MID │ Level 1 │ m        │
└─────────────────────────────────────────────────────────────┘
```

## Component inventory (`apps/web-editor/src/editor/`)

| Component                      | Role                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `editor.tsx`                   | Shell grid; composes everything below                    |
| `session-context.tsx`          | Creates ONE `EditorSession`, provides it via context     |
| `viewport/viewport2d-view.tsx` | Imperative island: two canvases + input pipeline         |
| `viewport/viewport2d.ts`       | Camera: pan/zoom matrix, screen↔world conversion        |
| `viewport/scene-renderer.ts`   | Immediate-mode Canvas2D drawing of the display list      |
| `viewport/viewer3d.tsx`        | Isolated Three.js read-only view                         |
| `tools/tool-manager.ts`        | Active tool switching; forwards abstract input           |
| `tools/select-tool.ts`         | Default tool: pick/toggle via core hit-testing           |
| `tools/line-tool.ts`           | Reference draw tool: snap, rubber band, chained LINE.ADD |
| `components/top-bar.tsx`       | Undo/redo, view tabs                                     |
| `components/tool-palette.tsx`  | Tool buttons (left rail)                                 |
| `components/command-line.tsx`  | Text input → dispatch; prompt + message log              |
| `components/status-bar.tsx`    | Live world coords, OSNAP, level, units                   |
| `components/panels.tsx`        | Right rail: properties, layers, levels                   |

View tabs switch the mounted viewport component (Canvas2D with a
`ViewDefinition{plan, levelId}` vs `Viewer3D`); both feed from the same
document.

## Icons (Decided 2026-07-12)

**`@tabler/icons-react`** — chosen for its stroke-based 24px style (matches
the canvas linework) and literal architecture glyphs (`IconWall`, `IconDoor`,
`IconWindow`, `IconMagnet` for OSNAP, `IconStack2` for levels) that other
packs lack. Named imports tree-shake under Vite (~4 kB for the chrome set).
House style: `stroke={1.75}`, 20px in the tool palette, 16px in bars.
Future domain-specific icons (join modes, plan/3D variants) are hand-drawn
SVGs on the same 24px stroke grid in a local `icons/` folder.

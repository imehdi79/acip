# Roadmap — Deferred Decisions & Open Questions

Last updated: 2026-07-11

## Deferred (intentionally postponed; the design leaves a slot)

| Topic | Status | Notes |
| --- | --- | --- |
| **editor-server** (persistence, collaboration) | Deferred by user decision — "we talk about editor server later" | The transaction **commit record stream is the future sync protocol**; core design already accommodates it. See [command-transaction.md](../03-contracts/command-transaction.md). |
| **IFC import/export** | Confirmed coming (user: yes) | Massive spec; `io/` + entity data schemas are the mapping anchors. Design `io/` knowing IFC arrives. |
| **Xrefs / underlays** (AutoCAD-style external attachments) | Deferred, not rejected | Touches io + rendering + document at once; design when those exist. |
| **3D editing** | Deferred (v1: 3D is read-only) | See [2.5D strategy](../04-systems/2-5d-strategy.md). |
| **Sections / elevations** | Deferred | Land as `ViewDefinition` with a cut plane. |
| **Roofs / freeform surfaces** | Deferred | Start as extrusions with slope parameter; OpenCascade-via-WASM as an island if ever truly needed. |
| **Parametric constraint solver** | Maybe never | Host relations (one-directional DAG) deliberately are NOT this. See [relations](../04-systems/relations.md). |
| **`editor-sdk` package** | Build when first external package lands | Until then `editor-core/src/index.ts` is the SDK contract. |

## Open questions

1. **Which AI agent first?** Drives which core APIs must be excellent earliest. See
   [ai-agents.md](../05-packages/ai-agents.md).

## Implementation status

**Scaffold landed 2026-07-11.** All four layers exist in `packages/editor-core/src`
with the keystone contracts implemented: Entity base + capability interfaces,
snapshot-based Transaction/CommitRecord/HistoryStack, CommandBus (nested dispatch
joins the parent transaction), RelationGraph (cycle-checked, cascade on erase),
registries, EditorSession facade, native JSON io, and reference implementations
(LineEntity; LINE.ADD / ENTITY.MOVE / ENTITY.ERASE). Verified by
`nx run editor-core:test` (bun test) and `nx run editor-core:typecheck`.

Known placeholders: NaiveSpatialIndex (linear scan behind the SpatialIndex
interface — swap for R-tree later), topology/offset/mesh algorithms,
annotations/blocks entities, and document-level stores (layers/levels/materials/
types) are not yet transactional.

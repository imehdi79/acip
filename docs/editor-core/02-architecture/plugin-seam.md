# The Plugin Seam — How External Packages Extend the Core

Status: **Decided** · Last updated: 2026-07-11

The requirement that shaped the whole architecture: **multiple AI agent packages will be
added later**, plus an estimator package, domain packs (architectural entities), and a 3D
viewer. None of them may require core changes to exist.

## The three mechanisms

1. **Registries** (`registry/`, Layer 2). Entity types, commands, tools, and snap
   providers are registered at startup, never hardcoded. An architectural package
   registers `Wall`/`Window`/`Door` entity types and their commands exactly the way core
   registers `LineEntity`. This is the difference between "agents are hardcoded features"
   and "agents are packages."

2. **The command bus as universal API** (`commands/`, Layer 3). Every mutation — human or
   agent — is a dispatched command. Because each command carries a typed parameter schema,
   one registration yields three consumers:
   - runtime validation,
   - AutoCAD-style command line parsing,
   - **an LLM tool definition** — the agent API falls out of the command registry for free.

3. **Events + read services.** External packages subscribe to batched document change
   events (emitted per committed transaction) and query through read-only services
   (`measurements/`, `document/spatial`, selection). They never reach into core internals.

## The SDK boundary

- Until `packages/editor-sdk` exists, **`editor-core/src/index.ts` is the SDK**: curated,
  deliberate exports only. Everything exported there is a compatibility promise.
- When external packages become real, extract `editor-sdk` as a thin package re-exporting
  the stable interfaces (EditorSession, command bus, registries, event types, read
  services). External packages depend on the SDK only.

## Proof case

The **estimator** is structurally identical to an AI agent: a read-only consumer that
walks the document via the SDK, queries measurements, subscribes to change events. If the
estimator can live as an external package, agent packages can too — it is the first real
tenant of the seam. See [estimator](../05-packages/estimator.md) and
[ai-agents](../05-packages/ai-agents.md).

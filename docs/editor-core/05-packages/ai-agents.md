# AI Agents — Integration Model

Status: **Decided** (integration model) · **Open** (which agent first) · Last updated: 2026-07-11

Multiple AI agents will be added later as independent packages (`packages/agents/*`,
e.g. `@acip/agent-drafter`, `@acip/agent-dimension`). This requirement shaped the core
architecture; this doc records *how* they plug in.

## The integration contract

An agent package:

1. **Observes** — subscribes to batched document change events (one per committed
   transaction).
2. **Reads** — queries geometry and semantics via read-only services: `measurements/`,
   `document/spatial` (R-tree), relations, levels, materials, estimator output.
3. **Acts** — dispatches commands through the command bus: `bus.dispatch(name, json)`.
   **Never mutates entities directly** (golden rule #2).
4. **Extends** (optionally) — registers new entity types, commands, tools, or snap
   providers via `registry/`.
5. **Depends on `editor-sdk` interfaces only** — never on core internals.

## Why this design

- **Command schemas are LLM tool definitions.** One command registration yields
  validation + command-line parsing + an agent-callable tool. The agent API is not a
  separate surface to maintain — it *is* the command registry.
- **Agent edits are transactions**: atomic, validated, and undoable with a single Ctrl+Z,
  exactly as if a person had done it. Nothing in core knows the agent package exists.
- **Headless core** means agents can run in Web Workers or server-side (editor-server as
  agent host) with no browser.
- **The semantic model is what makes agents viable at all**: host relations, levels,
  types, and materials make a drawing legible to an LLM. See
  [relations](../04-systems/relations.md).

## Worked example (future `@acip/agent-dimension`)

Subscribes to change events → queries geometry via measurements + spatial index →
dispatches `DIM` commands → arrives as one transaction the user can undo. Zero core
changes required.

## Candidate first agents (Open — pick one to drive SDK priorities)

- Drafting from a prompt (NL → commands)
- Auto-dimensioning
- Code-compliance checking
- Cost optimization (pairs with the [estimator](estimator.md))

The first agent chosen determines which core APIs need to be excellent earliest.

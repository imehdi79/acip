# AI Agents — Integration Model

Status: **Decided** (integration model; first agent = drafter, shipped 2026-07-12) · Last updated: 2026-07-12

Multiple AI agents will be added later as independent packages (`packages/agents/*`,
e.g. `@acip/agent-drafter`, `@acip/agent-dimension`). This requirement shaped the core
architecture; this doc records _how_ they plug in.

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
  separate surface to maintain — it _is_ the command registry.
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

## First agent: `@acip/agent-drafter` (Decided, shipped 2026-07-12)

Drafting from a prompt (NL → commands) was chosen because it was the only
candidate buildable with today's entities — auto-dimensioning needs dimension
entities, compliance needs rule data, cost optimization needs the estimator
package. It exercises the whole contract end to end.

### The core surface it consumes: `src/llm/` (Layer 3)

- **`toolDefinitions(registry)`** — projects the command registry into an LLM
  tool catalog (Anthropic Messages shape: name/description/input*schema).
  Every command's `describe()` (built with the `S` schema builders in
  `commands/schema.ts`) doubles as its tool schema; `description` on the
  Command doubles as the tool description. Tool names map dots to
  underscores (`WALL.ADD` ⇄ `WALL_ADD`) because tool names must match
  `^[a-zA-Z0-9*-]+$`; command names never contain underscores, so the
  mapping is lossless.
- **`describeDocument(doc)`** — LLM-legible digest: catalogs (levels, layers,
  materials, types), entities as their `saveData()` envelopes (persisted
  truth, nothing derived), host relations, quantity totals. Capped by
  `maxEntities` (default 200) with a truncation marker.

### Single Ctrl+Z: history groups

`HistoryStack.beginGroup()/endGroup()/runGrouped(fn)` collapse a run of
dispatches into one undo entry (stack entries are groups of commit records).
The agent wraps its whole run in `runGrouped` — safe across await points,
released on error, partial work still undoes atomically. Caveat: user
dispatches issued _during_ an open group would join it; the web-editor does
not yet run agents concurrently with user editing.

### The agent loop (in the package, not core)

`DrafterAgent.run(prompt)`: system prompt (drawing rules: meters, +y up,
walls auto-join, parametric t placement) + document digest + tool catalog →
model returns tool calls → each call dispatches through the bus →
**validation errors return to the model as `is_error` tool results so it can
self-correct** → loop until a text-only reply or `maxTurns`. The LLM client
is an injected interface (`LlmClient`, normalized in the Anthropic Messages
shape); tests script a fake, production picks a provider — the fetch-based
`AnthropicClient` or `OpenAiClient` (Codex / GPT), both SDK-free so the agent
stays headless everywhere the core runs. A new provider is a new client, not
an agent change: `OpenAiClient` translates the normalized shape ⇄ OpenAI Chat
Completions (tool_use ⇄ tool_calls, tool_result ⇄ `tool` messages,
`input_schema` ⇄ `function.parameters`). `onDispatch` streams per-command
progress to UIs; direct-browser calls are the user's-own-key case (Anthropic
needs a CORS opt-in header, OpenAI serves CORS) — hosted deployments proxy
via editor-server. web-editor wires this as a prompt row under the command
line, with a provider/model/key selector (see
[web-editor 04-agent.md](../../web-editor/04-agent.md)).

## Remaining candidates (build later, same contract)

- Auto-dimensioning (needs dimension entities)
- Code-compliance checking
- Cost optimization (pairs with the [estimator](estimator.md))

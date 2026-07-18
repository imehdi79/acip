# Agent Integration — the prompt box

Status: **Decided** (shipped 2026-07-12; multi-provider 2026-07-18)

The drafter agent surfaces as a second input row under the command line —
deliberately: the command line is the human face of the command bus, the
agent row is the natural-language face of the *same* bus. Both converge on
`session.dispatch`.

## How it works

- `src/editor/agent.ts` owns the run: builds an `LlmClient` (`AnthropicClient`
  or `OpenAiClient`) + `DrafterAgent` from `@acip/agent-drafter`, streams
  progress into the command log via the agent's `onDispatch` callback (one
  line per command, errors marked), then logs the model's summary. React stays
  thin — the `AgentRow` component collects the prompt and provider settings
  and calls `runDrafter`.
- **Busy state** lives in `EditorUi.agentBusy` (ValueStore); the input
  disables and the sparkles icon pulses while the agent draws. The viewport
  updates live as commands land — the drawing appears wall by wall.
- **Undo**: the whole run is one Ctrl+Z (history grouping in core). The
  finish line in the log says so.

## Providers (Anthropic + OpenAI / Codex)

`DrafterAgent` depends only on the `LlmClient` protocol (normalized in the
Anthropic Messages shape), so a second provider is just a second client, not
a change to the agent. `OpenAiClient` translates that normalized shape into
OpenAI Chat Completions messages + function tools and maps the reply back —
tool_use ⇄ tool_calls, tool_result ⇄ `tool` messages, `input_schema` ⇄
`function.parameters`, `finish_reason` ⇄ stop reason. Both clients are
fetch-based and SDK-free, so the agent stays as headless as the core.

The settings button reveals a **provider select**, a **model select** (the
list per provider — Anthropic: Fable 5 / Opus 4.8 / Sonnet 4.6 / Haiku 4.5;
OpenAI: GPT-5 Codex / GPT-5 / GPT-5 mini / GPT-4o / GPT-4o mini; first is the
default), and the **key** field. Provider, key, and model persist
per-provider in `localStorage` (`acip.agent-provider`,
`acip.{provider}-api-key`, `acip.{provider}-model`); switching provider loads
that provider's saved key and model.

Fetch note: both clients bind the default `fetch` to the global
(`fetch.bind(globalThis)`) — a browser `fetch` called as a method on any
object other than the window throws "Illegal invocation".

## API key handling (browser-only deployment)

Keys stay in this browser (`localStorage`) and are sent directly to the
provider. Anthropic needs the `anthropic-dangerous-direct-browser-access:
true` header (`dangerouslyAllowBrowser` on `AnthropicClient`); OpenAI serves
CORS for direct browser calls, so `OpenAiClient` sends only the `Bearer`
key. Direct-from-browser is acceptable **only** because the key belongs to
the person at the keyboard. A shared/hosted deployment must proxy through
editor-server instead — that slot is already reserved in the roadmap.

## Known caveat

While a run is in progress the user can still draw manually; those commands
would join the agent's history group (single shared undo). Acceptable for
now — revisit if runs get long enough for real interleaving.

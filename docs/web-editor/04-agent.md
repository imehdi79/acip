# Agent Integration — the chat panel

Status: **Decided** (shipped 2026-07-12; multi-provider 2026-07-18; chat +
voice 2026-07-18)

The drafter agent surfaces as a floating chat over the viewport — a sparkles
bubble bottom-right that opens into a conversation. Deliberately still the
same seam: the command line is the human face of the command bus, the chat
is the natural-language face of the *same* bus. Both converge on
`session.dispatch`.

## How it works

- `src/editor/agent.ts` owns the run: builds an `LlmClient` (`AnthropicClient`
  or `OpenAiClient`) + `DrafterAgent` from `@acip/agent-drafter`, streams
  progress to **two surfaces at once** — the command log (the bus trace, one
  line per command) and the chat (`EditorUi.agentChat`: user bubbles right,
  agent summaries left, per-command progress as small muted lines, errors
  red). React stays thin — `AgentChat` collects the prompt and provider
  settings and calls `runDrafter`.
- **Busy state** lives in `EditorUi.agentBusy` (ValueStore); the input
  disables, a "drawing…" typing indicator pulses, and the bubble icon pulses
  while collapsed. The viewport updates live as commands land — the drawing
  appears wall by wall behind the panel.
- **Undo**: the whole run is one Ctrl+Z (history grouping in core). The
  finish line in the chat says so.
- **Chat state** lives in `EditorUi` (`agentChat`, `agentChatOpen`), so
  minimizing the panel keeps the conversation.

## Voice (zero cost — browser Web Speech API)

No STT/TTS service, no backend, no key: dictation uses the browser's
`SpeechRecognition` (webkit-prefixed in Chrome/Edge), replies use
`speechSynthesis`. The mic button streams interim transcripts into the input
as a preview; the final transcript auto-sends, and **voice-initiated runs
speak the model's summary back** — talk in, hear out. Typed prompts stay
silent. Browsers without `SpeechRecognition` (Firefox) simply don't get a mic
button; everything else works unchanged. If cloud-grade accuracy is ever
needed, the upgrade path is Whisper (~$0.006/min) behind editor-server — the
hook's `onInterim`/`onFinal` contract wouldn't change.

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

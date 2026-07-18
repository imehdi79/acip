# Agent Integration — the chat panel

Status: **Decided** (shipped 2026-07-12; multi-provider 2026-07-18; chat +
voice 2026-07-18; editor-server proxy + Whisper voice + request log
2026-07-18)

The drafter agent surfaces as a floating chat over the viewport — a sparkles
bubble bottom-right that opens into a conversation. Deliberately still the
same seam: the command line is the human face of the command bus, the chat
is the natural-language face of the _same_ bus. Both converge on
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

## Voice (any language — Whisper behind editor-server)

Push-to-talk: the mic button records with `MediaRecorder` (all modern
browsers, Firefox included), a second click stops and POSTs the audio to
editor-server's `/api/stt`, which forwards it to OpenAI Whisper. **Whisper
auto-detects the spoken language**, so the user can draft in anything.
The transcript auto-sends, and voice-initiated runs speak the model's
summary back via `speechSynthesis` (free, built-in) — talk in, hear out.
Typed prompts stay silent. Cost is ~$0.006/min of audio; there is no
browser speech engine in the loop anymore.

## Providers (Anthropic + OpenAI / Codex)

`DrafterAgent` depends only on the `LlmClient` protocol (normalized in the
Anthropic Messages shape), so a second provider is just a second client, not
a change to the agent. `OpenAiClient` translates that normalized shape into
OpenAI Chat Completions messages + function tools and maps the reply back —
tool_use ⇄ tool_calls, tool_result ⇄ `tool` messages, `input_schema` ⇄
`function.parameters`, `finish_reason` ⇄ stop reason. Both clients are
fetch-based and SDK-free, so the agent stays as headless as the core.

The settings button reveals a **provider select** and a **model select**
(Anthropic: Fable 5 / Opus 4.8 / Sonnet 4.6 / Haiku 4.5; OpenAI: GPT-5
Codex / GPT-5 / GPT-5 mini / GPT-4o / GPT-4o mini; first is the default).
Provider and model persist per-provider in `localStorage`
(`acip.agent-provider`, `acip.{provider}-model`). There is no key field
anymore — keys live on the server.

Fetch note: both clients bind the default `fetch` to the global
(`fetch.bind(globalThis)`) — a browser `fetch` called as a method on any
object other than the window throws "Illegal invocation".

## API keys live in editor-server's .env (shipped 2026-07-18)

The browser never sees a provider key. Both `LlmClient`s point their
`baseUrl` at editor-server's `/api/llm/<provider>` — the proxy routes mirror
the provider paths exactly (`/v1/messages`, `/v1/chat/completions`), so the
clients needed zero changes, they just send an empty key and the server
injects the real one from `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
configured once). The web app finds the server via `VITE_EDITOR_SERVER_URL`
(dev default `http://localhost:3000`, empty = same origin), and the server's
`CORS_ORIGIN` allowlists the frontend origin.

## The request log (REQUEST.LOG → Prisma)

The drafter's system prompt tells it: asked for something you have no tool
for (an element, operation, or price)? Call `REQUEST_LOG` once, tell the
user it was recorded, continue with what you can do. `REQUEST.LOG` is a
**signal command** — it mutates nothing in the document (so undoing a run
never erases the record); `runDrafter` observes the dispatch and forwards it
to `POST /api/requests`, where editor-server persists it via Prisma into
Postgres (`Request`: kind = missing-feature | missing-price, text, context,
status open/done). `GET /api/requests` lists them; `PATCH /api/requests/:id`
closes them. That table is the product backlog, in users' own words.

## Known caveat

While a run is in progress the user can still draw manually; those commands
would join the agent's history group (single shared undo). Acceptable for
now — revisit if runs get long enough for real interleaving.

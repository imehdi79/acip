# Agent Integration — the prompt box

Status: **Decided** (shipped 2026-07-12)

The drafter agent surfaces as a second input row under the command line —
deliberately: the command line is the human face of the command bus, the
agent row is the natural-language face of the *same* bus. Both converge on
`session.dispatch`.

## How it works

- `src/editor/agent.ts` owns the run: builds an `AnthropicClient` +
  `DrafterAgent` from `@acip/agent-drafter`, streams progress into the
  command log via the agent's `onDispatch` callback (one line per command,
  errors marked), then logs the model's summary. React stays thin — the
  `AgentRow` component just collects the prompt and calls `runDrafter`.
- **Busy state** lives in `EditorUi.agentBusy` (ValueStore); the input
  disables and the sparkles icon pulses while the agent draws. The viewport
  updates live as commands land — the drawing appears wall by wall.
- **Undo**: the whole run is one Ctrl+Z (history grouping in core). The
  finish line in the log says so.

## API key handling (browser-only deployment)

The key is pasted into a field behind the key button, stored in
`localStorage` (`acip.anthropic-api-key`), and sent directly to the
Anthropic API with the `anthropic-dangerous-direct-browser-access: true`
header (exposed as `dangerouslyAllowBrowser` on `AnthropicClient`). This is
acceptable **only** because the key belongs to the person at the keyboard.
A shared/hosted deployment must proxy through editor-server instead — that
slot is already reserved in the roadmap.

## Known caveat

While a run is in progress the user can still draw manually; those commands
would join the agent's history group (single shared undo). Acceptable for
now — revisit if runs get long enough for real interleaving.

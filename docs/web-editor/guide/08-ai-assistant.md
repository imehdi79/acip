# AI assistant

[← Guide index](README.md)

The editor has a built-in **chat assistant** that can drive the same commands
you do — drawing, finishing, and estimating — in response to plain language. It
opens as a chat bubble (a side panel on desktop) and drives the *live* drawing,
so you watch it work and can undo anything it does.

## Two modes

The assistant works in one of two modes:

| Mode | What it does |
| --- | --- |
| **Drafter** | Draws and edits on request — *"add a 4 × 3 m room here", "put a window on that wall", "tile the bathroom to 1 m"*. It dispatches the changes immediately (all undoable). |
| **Estimator** | **Proposes** build-ups, finishes, and demolition/rebuild schemes and **applies nothing until you confirm** — for turning a brief into a costed scheme. |

Switching to estimator mode (the ✨ button on the Estimate panel) also turns on
**Marks**, so the assistant and you share the same names for walls and rooms
("finish W9", "the 3 m² room").

## What it's good for

- **Drafting** — rooms, walls, openings, slabs, stairs, dimensions.
- **Finishing** — apply plaster/paint/tile schemes, including per-face bands
  ("three kitchen walls plaster, one wall cement + tile") that are tedious to
  place by hand. See [Rooms & finishes](04-rooms-and-finishes.md).
- **Renovation** — mark existing finishes/floors/windows for demolition and
  propose the rebuild, so the [Demolition / Rebuild](05-demolition-and-phases.md)
  BOQ fills in.
- **Tracing** — the underlay **Trace** tool uses the assistant to read walls
  from a plan image.
- **Capturing gaps** — if you ask for something the toolset can't do yet (an
  element type or a price that doesn't exist), it records the request rather than
  failing silently.

## Voice

You can **speak** to the assistant instead of typing — the app sends the audio
to the server for transcription and drops the text into the chat.

## Setup — the assistant needs the editor server

The assistant talks to the **editor server**, which proxies the language model
and handles transcription and the request log. Point the app at a running server
and pick your **provider** (Anthropic or OpenAI) and **model** in the assistant
settings — your choice is remembered in the browser. Without a reachable server,
drawing and estimating still work fully; only the AI chat, voice, and underlay
tracing are unavailable.

> The rest of the app is completely usable offline — the assistant is an
> accelerator, not a dependency.

---

Next: [Reference →](09-reference.md)

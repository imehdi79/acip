# Estimator — Quantity Takeoff / BOQ / Cost

Status: **Decided** (design) · **Deferred** (build) · Last updated: 2026-07-11

> **Seed exists (2026-07-11):** `editor-core/src/measurements/quantities.ts`
> already computes wall net areas/volumes, per-material volumes from assembly
> layers, and opening counts; web-editor shows them live. The estimator package
> will consume this and add pluggable measurement rules + cost rates.

A separate package (`packages/estimator`), and the reason the semantic model exists:
quantity takeoff only works if the model knows "this is a wall with 12m² of tile finish."
The app's identity — **cost-aware building modeler** — is delivered here.

## Structural role: the first tenant of the plugin seam

The estimator is **structurally identical to an AI agent**: a read-only consumer that
walks the document through the SDK, queries `measurements/`, subscribes to change events,
never touches core internals. If the estimator can live as an external package, agent
packages can too.

## Internal structure

```
packages/estimator/src/
├── takeoff/           # quantity extraction: net wall areas, finish areas,
│                      # material volumes from assembly layers, counts
├── rules/             # measurement rules as pluggable providers
├── rates/             # unit cost data — loaded as DATA, never hardcoded
└── boq/               # bill-of-quantities assembly, grouping, reports
```

## Design decisions

- **Rules must be pluggable, not hardcoded.** How quantities are measured varies by
  country, standard, and firm (classic example: openings under 0.5m² are not deducted).
  Rules are registered providers — same registry pattern as everything else.
- **Rates are data, not code.** Cost data is volatile and regional; the engine computes
  quantities and applies external rate tables.
- **The dependency chain is the payoff for the whole architecture:** accurate tile
  quantity = wall face area − window openings ← host relation ← semantic model. A
  dumb-lines CAD clone fundamentally cannot do takeoff.
- **Live estimation is nearly free.** The estimator subscribes to batched change events;
  the relations graph already tracks dirty entities → an incrementally-updating cost
  panel (price ticking as the user drags a wall) is a modest feature and a killer demo.

## Agent connection

*"Value-engineer this floor to cut finish costs 10%"* = an agent that reads the
estimator's output and dispatches commands. The estimator produces the objective
function; agents optimize against it.

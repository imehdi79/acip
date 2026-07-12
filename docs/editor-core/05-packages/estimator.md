# Estimator — Quantity Takeoff / BOQ / Cost

Status: **Shipped** (v1, 2026-07-12) · Last updated: 2026-07-12

> **V1 shipped:** `packages/estimator` (`@acip/estimator`). Pipeline: takeoff
> facts (walls: gross volume, per-opening deductions, resolved assembly) →
> measurement rules (policy: `deducts` filter + `factor` multiplier; built-ins:
> small-opening threshold, waste allowance) → assembly-proportional split →
> rate table (data: costCode → unitCost) → BOQ lines + total + missingRates.
> `Estimator` class recomputes per committed transaction (live price ticking).
> `Material.costCode` is the core-side hook (one inert string — core never
> prices). web-editor shows a Cost section under Quantities with demo rates.
> The core quantities seed stays as the FACTS layer; this package is POLICY.

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

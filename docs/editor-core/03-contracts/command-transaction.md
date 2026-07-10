# Command & Transaction Interfaces

Status: **Decided** · Last updated: 2026-07-11

**Golden rule: the command bus is the only mutation path.** Humans, tools, and AI agents
all change the document exclusively through dispatched commands. Two structural
decisions, then the sketches.

## Decision 3: commands are non-interactive; tools do the talking

AutoCAD's LINE command prompts point-by-point. If prompting were baked into commands,
agents would block on questions and tests would simulate dialogue. Instead:

- A **command** takes complete, validated params and executes atomically. Pure, replayable.
- The click-by-click experience lives in **tools** (Layer 3): a `LineTool` state machine
  gathers points interactively, then dispatches the same `LINE.ADD` command an agent
  would call with coordinates upfront.

Human and agent paths converge on one tested code path.

## Decision 4: undo via before/after data snapshots, not inverse operations

Inverse-operation undo requires every command author to write correct inverse logic, and
cascaded effects ("window recomputed because its wall stretched") have no obvious
inverse. Instead, the transaction snapshots each touched entity's `saveData()` before
first touch and after commit. One mechanism, correct for **every entity type ever
registered — including types added later by packages the undo system has never heard
of**. Memory cost is trivial for 2D building models. Redo re-applies after-snapshots
(never re-executes) — deterministic by construction.

## The sketches

```ts
interface Command<P, R> {
  name: string;                        // 'WALL.ADD', 'ENTITY.MOVE', 'FINISH.APPLY'
  params: Schema<P>;                   // ONE schema → runtime validation,
                                       // command-line parsing, LLM tool definition
  execute(ctx: CommandContext, params: P): R;
}

interface CommandContext {
  doc: DrawingDocument;
  tx: Transaction;                     // opened by the bus — commands never
                                       // commit or roll back themselves
  measure: MeasurementService;         // read services injected, not imported
}

interface Transaction {
  create(e: Entity): void;
  update<E extends Entity>(e: E, mutate: (e: E) => void): void;
    // captures before-snapshot on first touch, after-snapshot at commit
  remove(e: Entity): void;
  attach(host: EntityId, hosted: EntityId, placement: PlacementParams): void;
  detach(rel: RelationRef): void;
    // relation-graph edits are transactional too — undo restores the
    // RELATIONSHIP, not just the shapes
}
```

## Bus lifecycle

`dispatch('WALL.ADD', rawParams)` →
1. validate params against the schema,
2. open a transaction,
3. `execute`,
4. commit → push record to history → emit **one batched change event**.

Any throw → rollback; the document is untouched. An AI agent's tool-use call is literally
`bus.dispatch(name, json)`.

## The commit record — quietly the most valuable object in the system

Commit produces one immutable record:

```ts
{ commandName, params, changes: { created, updated, removed, relations } }
```

Consumers:
- **history stack** — undo/redo by replaying snapshots
- **change event** — drives dirty propagation ([relations](../04-systems/relations.md)),
  spatial-index updates, rendering invalidation, and the estimator's incremental recompute
- **future editor-server** — a stream of these records *is* the sync/collaboration
  protocol. We are not designing collaboration now, but this contract means we will not
  have to redesign for it.

import type { EntityId, RelationId } from '../common/id.js';
import { newRelationId } from '../common/id.js';
import { RelationError } from '../common/errors.js';
import type { PlacementParams } from '../entities/base/capabilities.js';
import type { Relation } from './types.js';

/**
 * Host↔attachment dependency DAG. Deliberately NOT a constraint solver:
 * strictly one-directional, cycle-checked, recompute by dirty propagation.
 * See docs/editor-core/04-systems/relations.md.
 */
export class RelationGraph {
  private relations = new Map<RelationId, Relation>();
  private byHost = new Map<EntityId, Set<RelationId>>();
  private byHosted = new Map<EntityId, RelationId>();

  attach(
    hostId: EntityId,
    hostedId: EntityId,
    anchorIndex: number,
    params: PlacementParams,
  ): Relation {
    if (hostId === hostedId) {
      throw new RelationError(`entity ${hostId} cannot host itself`);
    }
    if (this.byHosted.has(hostedId)) {
      throw new RelationError(`entity ${hostedId} already has a host`);
    }
    if (this.wouldCycle(hostId, hostedId)) {
      throw new RelationError(`attaching ${hostedId} to ${hostId} would create a cycle`);
    }
    const relation: Relation = { id: newRelationId(), hostId, hostedId, anchorIndex, params };
    this.store(relation);
    return relation;
  }

  detach(relationId: RelationId): Relation {
    const relation = this.relations.get(relationId);
    if (!relation) throw new RelationError(`relation ${relationId} does not exist`);
    this.relations.delete(relationId);
    this.byHost.get(relation.hostId)?.delete(relationId);
    this.byHosted.delete(relation.hostedId);
    return relation;
  }

  /** re-attach with the SAME id — undo/redo and document loading */
  restore(relation: Relation): void {
    if (this.relations.has(relation.id)) {
      throw new RelationError(`relation ${relation.id} already exists`);
    }
    this.store(relation);
  }

  get(relationId: RelationId): Relation | null {
    return this.relations.get(relationId) ?? null;
  }

  relationsOfHost(hostId: EntityId): Relation[] {
    const ids = this.byHost.get(hostId);
    if (!ids) return [];
    const result: Relation[] = [];
    for (const id of ids) {
      const r = this.relations.get(id);
      if (r) result.push(r);
    }
    return result;
  }

  relationOfHosted(hostedId: EntityId): Relation | null {
    const id = this.byHosted.get(hostedId);
    return id ? (this.relations.get(id) ?? null) : null;
  }

  /** directly hosted entities */
  dependentsOf(hostId: EntityId): EntityId[] {
    return this.relationsOfHost(hostId).map((r) => r.hostedId);
  }

  /** downstream closure of the given entities, in dependency (BFS) order */
  collectDirty(changed: Iterable<EntityId>): EntityId[] {
    const dirty: EntityId[] = [];
    const seen = new Set<EntityId>();
    const queue = [...changed];
    while (queue.length > 0) {
      const id = queue.shift() as EntityId;
      for (const dep of this.dependentsOf(id)) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        dirty.push(dep);
        queue.push(dep);
      }
    }
    return dirty;
  }

  wouldCycle(hostId: EntityId, hostedId: EntityId): boolean {
    // walk up from hostId; if we reach hostedId, attaching would close a loop
    let current: EntityId | null = hostId;
    while (current !== null) {
      if (current === hostedId) return true;
      const rel: Relation | null = this.relationOfHosted(current);
      current = rel ? rel.hostId : null;
    }
    return false;
  }

  all(): Relation[] {
    return [...this.relations.values()];
  }

  /** @internal for document reset only */
  _clear(): void {
    this.relations.clear();
    this.byHost.clear();
    this.byHosted.clear();
  }

  private store(relation: Relation): void {
    this.relations.set(relation.id, relation);
    let hostSet = this.byHost.get(relation.hostId);
    if (!hostSet) {
      hostSet = new Set();
      this.byHost.set(relation.hostId, hostSet);
    }
    hostSet.add(relation.id);
    this.byHosted.set(relation.hostedId, relation.id);
  }
}

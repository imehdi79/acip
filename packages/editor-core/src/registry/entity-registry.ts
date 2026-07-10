import type { EntityId } from '../common/id.js';
import { RegistryError } from '../common/errors.js';
import type { Entity } from '../entities/base/entity.js';
import type { EntityData } from '../entities/base/data.js';

/**
 * Extension point: packages (domain packs, agents) register entity types here.
 * Also the deserialization factory — the schema anchor for io/IFC mapping.
 */
export interface EntityTypeRegistration {
  readonly type: string;
  create(id?: EntityId): Entity;
}

export class EntityTypeRegistry {
  private registrations = new Map<string, EntityTypeRegistration>();

  register(registration: EntityTypeRegistration): void {
    if (this.registrations.has(registration.type)) {
      throw new RegistryError(`entity type '${registration.type}' already registered`);
    }
    this.registrations.set(registration.type, registration);
  }

  has(type: string): boolean {
    return this.registrations.has(type);
  }

  get(type: string): EntityTypeRegistration {
    const reg = this.registrations.get(type);
    if (!reg) throw new RegistryError(`entity type '${type}' is not registered`);
    return reg;
  }

  list(): string[] {
    return [...this.registrations.keys()];
  }

  /** rebuild a live entity from persisted data (io, undo of a delete) */
  restore(data: EntityData): Entity {
    const entity = this.get(data.type).create(data.id as EntityId);
    entity.loadData(data);
    return entity;
  }
}

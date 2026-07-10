declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EntityId = Brand<string, 'EntityId'>;
export type LayerId = Brand<string, 'LayerId'>;
export type LevelId = Brand<string, 'LevelId'>;
export type MaterialId = Brand<string, 'MaterialId'>;
export type TypeId = Brand<string, 'TypeId'>;
export type RelationId = Brand<string, 'RelationId'>;

let fallbackCounter = 0;

export function newRawId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  fallbackCounter += 1;
  return `id-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

export const newEntityId = (): EntityId => newRawId() as EntityId;
export const newLayerId = (): LayerId => newRawId() as LayerId;
export const newLevelId = (): LevelId => newRawId() as LevelId;
export const newMaterialId = (): MaterialId => newRawId() as MaterialId;
export const newTypeId = (): TypeId => newRawId() as TypeId;
export const newRelationId = (): RelationId => newRawId() as RelationId;

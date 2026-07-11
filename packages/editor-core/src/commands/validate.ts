import type { EntityId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';

export function asPoint(value: unknown, label: string): Point {
  const p = value as Partial<Point> | null | undefined;
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
    throw new ValidationError(`${label} must be a point {x, y}`);
  }
  return { x: p.x, y: p.y };
}

export function asIdArray(value: unknown, label: string): EntityId[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ValidationError(`${label} must be an array of entity ids`);
  }
  return value as EntityId[];
}

export function asId(value: unknown, label: string): EntityId {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${label} must be an entity id`);
  }
  return value as EntityId;
}

export function asNumber(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a finite number`);
  }
  return value;
}

export function asPositive(value: unknown, label: string, fallback?: number): number {
  const n = asNumber(value, label, fallback);
  if (n <= 0) throw new ValidationError(`${label} must be positive`);
  return n;
}

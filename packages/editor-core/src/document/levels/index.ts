import type { LevelId } from '../../common/id.js';
import { newLevelId } from '../../common/id.js';
import { DocumentError } from '../../common/errors.js';

/** Horizontal datum: "Level 2 @ +3.00m". Entities associate via ILevelAware. */
export interface Level {
  readonly id: LevelId;
  name: string;
  elevation: number;
}

export class LevelTable {
  private levels = new Map<LevelId, Level>();

  add(name: string, elevation: number, id?: LevelId): Level {
    const level: Level = { id: id ?? newLevelId(), name, elevation };
    if (this.levels.has(level.id)) {
      throw new DocumentError(`level ${level.id} already exists`);
    }
    this.levels.set(level.id, level);
    return level;
  }

  get(id: LevelId): Level | null {
    return this.levels.get(id) ?? null;
  }

  remove(id: LevelId): boolean {
    return this.levels.delete(id);
  }

  /** ordered by elevation, bottom to top */
  list(): Level[] {
    return [...this.levels.values()].sort((a, b) => a.elevation - b.elevation);
  }
}

import type { LevelId } from '../../common/id.js';
import { newLevelId } from '../../common/id.js';
import { DocumentError } from '../../common/errors.js';
import { RecordTable } from '../store.js';

/** Horizontal datum: "Level 2 @ +3.00m". Entities associate via ILevelAware. */
export interface Level {
  readonly id: LevelId;
  name: string;
  elevation: number;
}

export class LevelTable extends RecordTable<Level> {
  add(name: string, elevation: number, id?: LevelId): Level {
    const level: Level = { id: id ?? newLevelId(), name, elevation };
    if (this.has(level.id)) {
      throw new DocumentError(`level ${level.id} already exists`);
    }
    this.set(level);
    return level;
  }

  remove(id: LevelId): boolean {
    return this.delete(id);
  }

  /** ordered by elevation, bottom to top */
  override list(): Level[] {
    return super.list().sort((a, b) => a.elevation - b.elevation);
  }
}

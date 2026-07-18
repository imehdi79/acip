import type { LayerId } from '../common/id.js';
import { newLayerId } from '../common/id.js';
import { RecordTable } from './store.js';

export interface Layer {
  readonly id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  /** ByLayer stroke color (CSS); renderers fall back to their default */
  color?: string;
}

export const DEFAULT_LAYER_ID = '0' as LayerId;

export function createDefaultLayer(): Layer {
  return { id: DEFAULT_LAYER_ID, name: '0', visible: true, locked: false };
}

export class LayerTable extends RecordTable<Layer> {
  add(name: string, id?: LayerId): Layer {
    const layer: Layer = {
      id: id ?? newLayerId(),
      name,
      visible: true,
      locked: false,
    };
    this.set(layer);
    return layer;
  }
}

import type { LayerId } from '../common/id.js';

export interface Layer {
  readonly id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
}

export const DEFAULT_LAYER_ID = '0' as LayerId;

export function createDefaultLayer(): Layer {
  return { id: DEFAULT_LAYER_ID, name: '0', visible: true, locked: false };
}

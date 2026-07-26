/**
 * Construction phase of an authored element. `new` is the built work (supply +
 * install, the default for everything drawn); `demolish` is the reverse — the
 * SAME geometry and quantity, but existing fabric to be REMOVED, priced against
 * a demolition rate instead of an install rate. A demolish finish is a tile
 * band or floor to be stripped; a demolish opening is a window/door to be taken
 * out. The renovation half of the model: "demolition is finish in reverse".
 * See docs/editor-core/04-systems/finishes.md.
 */
export type Phase = 'new' | 'demolish';

export const PHASES: readonly Phase[] = ['new', 'demolish'];

export function isPhase(value: unknown): value is Phase {
  return value === 'new' || value === 'demolish';
}

/** load-time coercion: unknown/missing phase falls back to `new` (back-compat) */
export function asPhase(value: unknown): Phase {
  return value === 'demolish' ? 'demolish' : 'new';
}

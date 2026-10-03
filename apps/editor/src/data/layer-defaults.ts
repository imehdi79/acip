import { ValueStore } from '@/editor/store';

/**
 * What a layer starts as when it is applied, and what it is for.
 *
 * Core models a finish's extent on the ENTITY — `t0`/`t1` and `topHeight` on a
 * wall band, `coverWidth`/`coverHeight` on a slab — and has nowhere to say
 * "a layer of this material usually covers so much". It should not: a default
 * is not a measurement, and putting one on the material would make every
 * drawing that opened the file inherit one office's habits as fact.
 *
 * So it lives here, beside the rates, for the same reason and in the same
 * shape: keyed by cost code, merged over nothing, persisted to the browser.
 * Cost code rather than material id because a material id is per document and
 * regenerates with every new one, while `plaster` is `plaster` in every plan
 * this device has ever drawn — the same key the price is already filed under.
 *
 * A default is only ever read at the MOMENT a layer is applied. Changing one
 * never reaches back into a finish somebody has already measured: the number
 * in the row is what the drawing says, and this is only what the next one
 * starts at.
 */
export interface LayerDefaults {
  /** metres across, from where the band begins */
  readonly width?: number;
  /** metres up from the ground to the top of the band */
  readonly height?: number;
  /** what this layer is, in the estimator's own words */
  readonly description?: string;
}

export const LAYER_DEFAULTS_KEY = 'acip.layer-defaults.v1';

/** nothing recorded for this code — every field left to the drawing */
const NONE: LayerDefaults = {};

/**
 * Is this a set of defaults, or something a corrupt key left behind?
 *
 * Every field is optional and every field is checked, because a width read as
 * a string would not throw — it would be handed to `coverPatch` and come out
 * as a `t1` of NaN, which is a band the document cannot draw.
 */
function isDefaults(value: unknown): value is LayerDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  for (const key of ['width', 'height'] as const) {
    const size = raw[key];
    if (size === undefined) continue;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      return false;
    }
  }
  const note = raw['description'];
  return note === undefined || typeof note === 'string';
}

export const layerDefaultsStore = new ValueStore<
  Readonly<Record<string, LayerDefaults>>
>({});

/** everything this device has recorded, right now */
export function currentLayerDefaults(): Readonly<
  Record<string, LayerDefaults>
> {
  return layerDefaultsStore.get();
}

/**
 * What a layer of this material starts as.
 *
 * Empty and never null, so a caller reads `defaultsFor(code).width` without
 * asking first — "nobody has said" and "said nothing in particular" are the
 * same answer here, unlike a price, where they are famously not.
 */
export function defaultsFor(costCode: string): LayerDefaults {
  return layerDefaultsStore.get()[costCode.trim()] ?? NONE;
}

/** everything kept for next time, or nothing when the key is unreadable */
export function readLayerDefaults(
  store: Storage,
): Readonly<Record<string, LayerDefaults>> {
  try {
    const raw = store.getItem(LAYER_DEFAULTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const all: Record<string, LayerDefaults> = {};
    for (const [code, one] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (code && isDefaults(one)) all[code] = one;
    }
    return all;
  } catch {
    return {};
  }
}

/** keep them, or carry on without them — a full or blocked store is not fatal */
export function writeLayerDefaults(
  store: Storage,
  all: Readonly<Record<string, LayerDefaults>>,
): boolean {
  try {
    store.setItem(LAYER_DEFAULTS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/**
 * Record what a layer of this material starts as.
 *
 * REPLACES rather than merges. The form that calls this shows every field at
 * once, so what it hands over is the whole answer — merging would make a
 * cleared box mean "leave it as it was", and there would then be no way to
 * take a default back off.
 *
 * An entry with nothing in it is dropped instead of stored, so clearing every
 * box returns the code to "nobody has said" rather than leaving an empty
 * record behind for `readLayerDefaults` to carry forever.
 */
export function setLayerDefaults(
  costCode: string,
  defaults: LayerDefaults,
  store?: Storage,
): boolean {
  const code = costCode.trim();
  if (!code || !isDefaults(defaults)) return false;
  const kept: LayerDefaults = {};
  if (defaults.width !== undefined)
    Object.assign(kept, { width: defaults.width });
  if (defaults.height !== undefined)
    Object.assign(kept, { height: defaults.height });
  const note = defaults.description?.trim();
  if (note) Object.assign(kept, { description: note });

  const all = { ...layerDefaultsStore.get() };
  if (Object.keys(kept).length === 0) delete all[code];
  else all[code] = kept;
  layerDefaultsStore.set(all);

  if (!store) return false;
  return writeLayerDefaults(store, all);
}

/** what this device recorded, back at start-up */
export function hydrateLayerDefaults(store: Storage): void {
  const all = readLayerDefaults(store);
  if (Object.keys(all).length === 0) return;
  layerDefaultsStore.set(all);
}

/** back to nothing recorded — for tests, which share one module instance */
export function resetLayerDefaults(): void {
  layerDefaultsStore.set({});
}

/** the defaults a drawing needs, lifted out of the live set — see snapshotRates */
export function snapshotLayerDefaults(
  costCodes: Iterable<string>,
): Record<string, LayerDefaults> {
  const all = layerDefaultsStore.get();
  const snapshot: Record<string, LayerDefaults> = {};
  for (const code of costCodes) {
    const one = all[code];
    if (one) snapshot[code] = one;
  }
  return snapshot;
}

/**
 * Start layers the way one saved plan started them.
 *
 * Rebuilt from this device's own record with the plan's snapshot on top, for
 * the reason `applyProjectRates` is: opening plan B must not leave plan A's
 * sizes behind.
 */
export function applyProjectLayerDefaults(
  snapshot: Readonly<Record<string, LayerDefaults>>,
  store?: Storage,
): void {
  const mine = store ? readLayerDefaults(store) : {};
  layerDefaultsStore.set({ ...mine, ...snapshot });
}

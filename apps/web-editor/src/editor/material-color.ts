import type { Material } from '@acip/editor-core';

export const DEFAULT_DISPLAY_COLOR = '#8fa3b8';

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * One display color per material, shared by the 3D viewer and the catalog
 * swatches. `appearance.color` wins; otherwise a stable name-derived tint so
 * materials stay distinguishable with zero configuration. Always returns a
 * hex string so `<input type="color">` can consume it.
 */
export function materialDisplayColor(material: Material | null | undefined): string {
  if (!material) return DEFAULT_DISPLAY_COLOR;
  const color = material.appearance?.['color'];
  if (typeof color === 'string' && color) return color;
  let hash = 0;
  for (let i = 0; i < material.name.length; i++) {
    hash = (hash * 31 + material.name.charCodeAt(i)) >>> 0;
  }
  return hslToHex(hash % 360, 0.32, 0.6);
}

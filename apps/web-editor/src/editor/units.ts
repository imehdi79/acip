import { ValueStore } from './store';

/**
 * Display/parse units for LINEAR dimensions. The model is always meters (world
 * = meters, everywhere); units live only at the edges — display and input.
 * Adding ft-in later is a new entry here and nothing else changes.
 */
export type LengthUnit = 'm' | 'cm' | 'mm';

interface UnitInfo {
  label: string;
  /** value in this unit for one meter (meters × perMeter = unit value) */
  perMeter: number;
  decimals: number;
}

const UNITS: Record<LengthUnit, UnitInfo> = {
  m: { label: 'm', perMeter: 1, decimals: 2 },
  cm: { label: 'cm', perMeter: 100, decimals: 0 },
  mm: { label: 'mm', perMeter: 1000, decimals: 0 },
};

export const LENGTH_UNITS: LengthUnit[] = ['m', 'cm', 'mm'];

const STORAGE_KEY = 'acip.length-unit';

function initialUnit(): LengthUnit {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'cm' || raw === 'mm' || raw === 'm') return raw;
  } catch {
    // storage blocked — fall through to the default
  }
  return 'm';
}

/** the active linear unit; every length surface subscribes to this */
export const lengthUnit = new ValueStore<LengthUnit>(initialUnit());

export function setLengthUnit(unit: LengthUnit): void {
  lengthUnit.set(unit);
  try {
    localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    // best-effort persistence
  }
}

export function unitLabel(unit: LengthUnit = lengthUnit.get()): string {
  return UNITS[unit].label;
}

/** meters → display string in the active (or given) unit, with the suffix */
export function formatLength(
  meters: number,
  unit: LengthUnit = lengthUnit.get(),
): string {
  return `${formatLengthValue(meters, unit)} ${UNITS[unit].label}`;
}

/** meters → number-only string (no suffix), for prefilling input fields */
export function formatLengthValue(
  meters: number,
  unit: LengthUnit = lengthUnit.get(),
): string {
  const info = UNITS[unit];
  return (meters * info.perMeter).toFixed(info.decimals);
}

/**
 * User text → meters, or null when unparseable. Accepts a bare number in the
 * active unit ("3.5"), or an explicit suffix that overrides it ("350 cm",
 * "3.5m", "40mm") — so a power user is never locked into the current unit.
 */
export function parseLength(
  text: string,
  unit: LengthUnit = lengthUnit.get(),
): number | null {
  const match = /^\s*([+-]?\d*\.?\d+)\s*(mm|cm|m)?\s*$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const resolved = (match[2]?.toLowerCase() as LengthUnit) || unit;
  return value / UNITS[resolved].perMeter;
}

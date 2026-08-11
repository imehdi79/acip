import type { EditorSession } from '@acip/editor-core';
import { HostedOpeningEntity, WindowEntity } from '@acip/editor-core';
import { lengthUnit, parseLength } from '@/editor/units';

export type OpeningField = 'width' | 'height' | 'sill' | 'thickness';

/** what the four inputs hold; blank means "leave this alone" */
export type OpeningEdits = Record<OpeningField, string>;

/** render order, and the order bad fields are reported in */
const FIELDS: OpeningField[] = ['width', 'height', 'sill', 'thickness'];

/** the selected windows and doors, in selection order */
export function selectedOpenings(
  session: EditorSession,
): HostedOpeningEntity[] {
  const openings: HostedOpeningEntity[] = [];
  for (const id of session.selection.list()) {
    const entity = session.doc.get(id);
    if (entity instanceof HostedOpeningEntity) openings.push(entity);
  }
  return openings;
}

/**
 * Whether "height from the ground" is a question worth asking. A door opens at
 * floor level and stores no sill at all, so for one the field is not disabled
 * or zeroed — it is not there.
 */
export const hasSill = (openings: readonly HostedOpeningEntity[]): boolean =>
  openings.length > 0 &&
  openings.every((opening) => opening instanceof WindowEntity);

/** meters, or null when the text is unparseable or not a usable size */
function meters(text: string): number | null {
  if (text.trim() === '') return null;
  const value = parseLength(text, lengthUnit.get());
  return value !== null && value > 1e-3 ? value : null;
}

/**
 * Meters above the floor, or null when unusable. Unlike a size, 0 is a real
 * answer here — a sill can sit on the floor — so only a negative one is bad.
 */
function elevation(text: string): number | null {
  if (text.trim() === '') return null;
  const value = parseLength(text, lengthUnit.get());
  return value !== null && value >= 0 ? value : null;
}

const parse = (field: OpeningField, text: string): number | null =>
  field === 'sill' ? elevation(text) : meters(text);

/**
 * Apply the edited dimensions to the selected openings. Returns the fields
 * that were filled in but unusable — non-empty means nothing was applied, so a
 * bad height cannot land a good width on its own and leave the dialog half
 * done.
 *
 * No history group: all four properties travel in ONE command, so the edit is
 * already one undo.
 */
export function applyOpeningMeasurements(
  session: EditorSession,
  openings: readonly HostedOpeningEntity[],
  edits: OpeningEdits,
): OpeningField[] {
  // the sill field is hidden for doors, and the command rejects a non-zero
  // sill aimed at one — so drop anything left in it from a previous selection
  // rather than send a request that can only fail
  const wanted: OpeningEdits = {
    ...edits,
    sill: hasSill(openings) ? edits.sill : '',
  };

  const invalid = FIELDS.filter(
    (field) =>
      wanted[field].trim() !== '' && parse(field, wanted[field]) === null,
  );
  if (invalid.length > 0) return invalid;

  const width = meters(wanted.width);
  const height = meters(wanted.height);
  const thickness = meters(wanted.thickness);
  const sill = elevation(wanted.sill);
  if (
    width === null &&
    height === null &&
    thickness === null &&
    sill === null
  ) {
    return [];
  }

  session.dispatch('OPENING.SETPROPS', {
    ids: openings.map((opening) => opening.id),
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height } : {}),
    ...(sill !== null ? { sill } : {}),
    ...(thickness !== null ? { thickness } : {}),
  });
  return [];
}

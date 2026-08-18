import { useEffect, useState } from 'react';
import { Label, Switch } from '@heroui/react';
import { coverPatch, type FinishRow } from './estimator-finishes';

/**
 * A number the user types, committed when they leave the field.
 *
 * On BLUR and not on every keystroke, which is the whole reason this holds a
 * draft at all. Every commit is a dispatch and every dispatch is an undo
 * entry: typing "1.25" a character at a time would put four steps on the undo
 * stack and re-derive the quantity four times — three of them for a number the
 * user was still in the middle of writing, and "1.2" is a real band, just not
 * the one they meant. Committing once, when they look away, makes one edit one
 * entry.
 *
 * A native input, for the reason the one other native control in this app is
 * native: on a phone `inputMode="decimal"` is the OS numeric keypad, and it
 * arrives without a popover to place over a sheet that is already parked over
 * the drawing.
 *
 * The draft resyncs whenever the committed value moves underneath it — an
 * undo, or the command clamping something — so the box can never sit showing a
 * number the document did not accept.
 */
function NumberInput({
  label,
  value,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  /** the unit shown after the box: `m`, `%` */
  suffix: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = Number.parseFloat(draft);
    // a blank or half-typed box is not an edit, it is a field the user walked
    // away from; putting the committed value back beats dispatching NaN
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };

  return (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          // Enter commits too: a phone keyboard's return key is where a thumb
          // goes to say "done", and tapping elsewhere to dismiss the keyboard
          // is the same gesture as blurring
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="w-16 rounded-sm border border-separator bg-surface px-2 py-1 text-right tabular-nums"
        />
        <span className="w-4 text-muted">{suffix}</span>
      </span>
    </label>
  );
}

/**
 * The inputs behind a row's chevron.
 *
 * Deliberately three controls and no more. Everything a finish carries can be
 * edited elsewhere in the app, and a second set of boxes for the sill, the
 * extent, the thickness and the phase made this panel a duplicate of that —
 * one more place for the same value to be wrong in, on the screen with the
 * least room to show it. What survives is what an estimator actually measures
 * standing in the room: how wide, how tall, and whether the openings come out.
 *
 * WIDTH and HEIGHT are metres on both hosts, which is the point of stating
 * them this way: the document holds a wall band as parameters along a baseline
 * and a floor as an unanchored rectangle, and neither is a number anyone says
 * out loud. `coverPatch` turns what is typed back into whichever the host
 * keeps, so nothing here knows which it is looking at.
 *
 * The opening toggle appears on a WALL FACE only. A slab has no openings to
 * argue about, and core rejects the flag for one rather than letting it be set
 * where it could never do anything — so a floor showing that switch would be
 * offering a save that throws.
 *
 * Fully controlled and free of the session, so a test can render it at any
 * state and read back exactly what it offers.
 */
export function FinishFields({
  row,
  onEdit,
  onDeduct,
}: {
  row: FinishRow;
  onEdit: (patch: Record<string, number>) => void;
  onDeduct: (deductOpenings: boolean) => void;
}) {
  const cover = row.cover;
  if (!cover) return null;

  return (
    <div className="flex flex-col gap-1 pt-1 text-xs">
      <NumberInput
        label="Width"
        value={cover.width}
        suffix="m"
        onCommit={(width) => onEdit(coverPatch(cover, { width }))}
      />
      <NumberInput
        label="Height"
        value={cover.height}
        suffix="m"
        onCommit={(height) => onEdit(coverPatch(cover, { height }))}
      />
      {cover.host === 'wall' && (
        // Net or solid. Not a preference: they are two measurement
        // conventions, and under the solid one the doors and windows are
        // billed as their own items rather than being folded into the face.
        <div className="flex items-center justify-between gap-2 py-1">
          <Label>Take out doors and windows</Label>
          <Switch
            isSelected={row.deductOpenings}
            onChange={(on) => onDeduct(on)}
          />
        </div>
      )}
    </div>
  );
}

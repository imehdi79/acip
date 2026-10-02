import { useEffect, useState } from 'react';
import { Checkbox, Label, Switch } from '@heroui/react';
import { coverBounds, coverPatch, type FinishRow } from './estimator-finishes';
import { currentRates, formatMoney } from '@/data/rates';
import type { OpeningRow } from './estimator-openings';

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
/**
 * A metre reading, to the centimetre.
 *
 * The numbers reaching these boxes are derived, not typed: a width is
 * `(t1 - t0) x length`, and floating point hands back 5.699999999999999 for a
 * wall somebody measured at 5.7. Nobody builds to the eleventh decimal, so the
 * box does not offer one.
 *
 * The rounding is applied on the way OUT as well as on the way in — what is
 * committed is what was read — so the document stops accumulating the noise
 * rather than merely hiding it, and a value that comes back through the reader
 * matches the draft it was typed into instead of re-rendering as a different
 * number.
 */
export function toCentimetre(value: number): number {
  return Math.round(value * 100) / 100;
}

function NumberInput({
  label,
  value,
  suffix,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  /** the unit shown after the box: `m`, `%` */
  suffix: string;
  /** the smallest sensible value; anything under it clamps up to it */
  min?: number;
  /** the largest the host allows, when the host allows one at all */
  max?: number;
  onCommit: (value: number) => void;
}) {
  const shown = toCentimetre(value);
  const [draft, setDraft] = useState(String(shown));
  useEffect(() => setDraft(String(shown)), [shown]);

  const commit = () => {
    const next = toCentimetre(Number.parseFloat(draft));
    // a blank or half-typed box is not an edit, it is a field the user walked
    // away from; putting the committed value back beats dispatching NaN
    if (!Number.isFinite(next)) {
      setDraft(String(shown));
      return;
    }
    // CLAMPED, not refused. The command rejects a band past the end of its
    // wall by throwing, and a throw inside a tap handler takes the sheet with
    // it — so an over-long width becomes the wall's own length, which is both
    // the nearest true answer and visibly not what was typed.
    let bounded = next;
    if (min !== undefined) bounded = Math.max(min, toCentimetre(bounded));
    if (max !== undefined) bounded = Math.min(toCentimetre(max), bounded);
    bounded = toCentimetre(bounded);
    if (bounded !== next) setDraft(String(bounded));
    // against the ROUNDED value, or a wall whose true width is 5.699999999
    // would dispatch on every blur for a number that never changed on screen
    if (bounded !== shown) onCommit(bounded);
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
  openings,
  onEdit,
  onDeduct,
  onDemolish,
  onDemolishToggle,
  onDemolishOpening,
}: {
  row: FinishRow;
  /** the doors and windows in the wall this layer sits on; empty for a slab */
  openings: readonly OpeningRow[];
  onEdit: (patch: Record<string, number>) => void;
  onDeduct: (deductOpenings: boolean) => void;
  /** the strip-out extent, which is a finish of its own and not this one */
  onDemolish: (next: { width?: number; height?: number }) => void;
  /** turn the strip-out on or off — it exists as an entity only while on */
  onDemolishToggle: (on: boolean) => void;
  onDemolishOpening: (openingId: string, demolish: boolean) => void;
}) {
  const cover = row.cover;
  if (!cover) return null;
  const onWall = cover.host === 'wall';
  const bounds = coverBounds(cover);

  return (
    <div className="flex flex-col gap-1 pt-1 text-xs">
      <NumberInput
        label="Width"
        value={cover.width}
        suffix="m"
        min={bounds.width.min}
        max={bounds.width.max}
        onCommit={(width) => onEdit(coverPatch(cover, { width }))}
      />
      {/* the second dimension is not the same measurement on both hosts, and
          calling both of them "height" made a floor read as though it stood
          up: a wall band is measured UP FROM THE GROUND, a floor is measured
          across the plan and has a length */}
      <NumberInput
        label={onWall ? 'Height from ground' : 'Length'}
        value={cover.height}
        suffix="m"
        min={bounds.height.min}
        max={bounds.height.max}
        onCommit={(height) => onEdit(coverPatch(cover, { height }))}
      />
      {onWall && (
        // Net or solid. Not a preference: they are two measurement
        // conventions, and under the solid one the doors and windows are
        // billed as their own items rather than being folded into the face.
        <Switch
          isSelected={row.deductOpenings}
          onChange={onDeduct}
          className="w-full py-1"
        >
          {/* Switch.Content IS the pressable element — react-aria's
              SwitchButton. Without it the track and thumb render and nothing
              is tappable, which is a control that looks live and is not. The
              label goes inside it so the words toggle too, which on a phone is
              most of the target. */}
          <Switch.Content className="w-full justify-between gap-2">
            <Label>Take out doors and windows</Label>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      )}
      {/* What is being torn OUT, stated beside what is going in. A layer is
          not one or the other: a room is stripped and then rebuilt, and the
          two quantities are both real and both priced — the strip-out against
          its own demo- code at its own rate. */}
      <div className="border-t border-separator pt-1">
        {/* Demolition is OFF until somebody says otherwise, and the figures
            only exist once it is on. A strip-out nobody asked for would price
            every refurbishment as a demolition, and boxes standing ready for
            one read as though it had already been decided. */}
        <Switch
          isSelected={row.demolition.on}
          onChange={onDemolishToggle}
          className="w-full py-1"
        >
          <Switch.Content className="w-full justify-between gap-2">
            <Label className="font-medium">Demolition</Label>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        {row.demolition.on && (
          <>
            <NumberInput
              label="Width"
              value={row.demolition.width}
              suffix="m"
              min={bounds.width.min}
              max={bounds.width.max}
              onCommit={(width) => onDemolish({ width })}
            />
            <NumberInput
              label={onWall ? 'Height from ground' : 'Length'}
              value={row.demolition.height}
              suffix="m"
              min={bounds.height.min}
              max={bounds.height.max}
              onCommit={(height) => onDemolish({ height })}
            />
            {/* the strip-out is priced against its OWN code at its own rate:
            tearing tile off a wall costs a fraction of laying it, and has
            nothing to do with what the tile was worth */}
            <p className="py-1 text-muted">
              {row.demolition.quantity <= 0
                ? 'Nothing being taken off yet.'
                : row.demolition.priced
                  ? `${row.demolition.quantity.toFixed(2)} m² · ${formatMoney(row.demolition.priced.amount, currentRates().currency)}`
                  : `${row.demolition.quantity.toFixed(2)} m² · no rate for ${row.demolition.costCode} yet`}
            </p>
          </>
        )}
        {/* one box per opening actually in this wall, because "does the door
            go too" is a question about that door and not about the layer —
            marking it sends the door to the bill as its own strip-out line */}
        {openings.map((opening) => (
          <Checkbox
            key={opening.id}
            isSelected={opening.demolish}
            onChange={(on) => onDemolishOpening(opening.id, on)}
            className="w-full py-1"
          >
            <Checkbox.Content className="gap-2">
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Take out {opening.name}</Label>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
    </div>
  );
}

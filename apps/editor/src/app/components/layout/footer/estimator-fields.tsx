import { useEffect, useState } from 'react';
import { Label, Switch, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import type { Phase } from '@acip/editor-core';
import type { FinishRow } from './estimator-finishes';

/**
 * One edit to a finish, in FINISH.UPDATE's own vocabulary.
 *
 * Only the fields that actually changed travel, because that is exactly what
 * the command promises to honour: everything omitted keeps its current value.
 * A field nobody touched is therefore never sent, and cannot be blamed for a
 * cross-field rejection it had nothing to do with.
 */
export interface FinishEdit {
  sillHeight?: number;
  topHeight?: number;
  /** clears topHeight — the only way to say "back to the top of the wall" */
  fullHeight?: true;
  t0?: number;
  t1?: number;
  thickness?: number;
}

/**
 * When the band stops running to the top of the wall, it has to stop
 * SOMEWHERE, and the wall's own height is not a number this row knows.
 *
 * A metre above the sill: high enough to be a band the user can see on the
 * plan and then drag to what they meant, rather than a zero-height finish that
 * prices as nothing and reads as a bug.
 */
const DEFAULT_BAND_HEIGHT = 1;

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
 * The inputs behind a row's chevron — what this layer covers, and whether it
 * is being built or torn out.
 *
 * Which inputs appear is decided by two things and never by the layer's name:
 * the HOST (a wall face carries a band; a slab finish is its whole footprint,
 * and core rejects the band fields for one outright rather than ignoring them)
 * and the material's UNIT (only an m³ material bills on thickness, so offering
 * that box elsewhere would be a control over a number nobody is charged for).
 * Two hosts and four units is a small matrix, not a bespoke form per layer —
 * which is why there is no schema engine here and does not need to be one.
 *
 * The extent is shown as a PERCENTAGE along the wall. Core stores `t0`/`t1` as
 * 0..1 baseline parameters, which is right for geometry and unreadable on a
 * phone: "0.35" is a number an estimator has to decode, "35 %" is one they can
 * check against the drawing sitting behind the sheet.
 *
 * Fully controlled and free of the session, so a test can render it at any
 * state and read back exactly what it offers.
 */
export function FinishFields({
  row,
  onEdit,
  onPhase,
}: {
  row: FinishRow;
  onEdit: (patch: FinishEdit) => void;
  onPhase: (phase: Phase) => void;
}) {
  const band = row.band;

  return (
    <div className="flex flex-col gap-1 pt-1 text-xs">
      {band && (
        <>
          <NumberInput
            label="From floor"
            value={band.sillHeight}
            suffix="m"
            onCommit={(sillHeight) => onEdit({ sillHeight })}
          />
          {/* the null state gets a switch of its own, because no number can
              stand for "up to the top of the wall, and still up to the top
              once the wall grows" */}
          <div className="flex items-center justify-between gap-2 py-1">
            <Label>Full height</Label>
            <Switch
              isSelected={band.topHeight === null}
              onChange={(on) =>
                onEdit(
                  on
                    ? { fullHeight: true }
                    : { topHeight: band.sillHeight + DEFAULT_BAND_HEIGHT },
                )
              }
            />
          </div>
          {/* only when there is a top to edit: with the switch on, the band
              has no top of its own and a box showing one would be inventing a
              number the document does not hold */}
          {band.topHeight !== null && (
            <NumberInput
              label="Up to"
              value={band.topHeight}
              suffix="m"
              onCommit={(topHeight) => onEdit({ topHeight })}
            />
          )}
          <NumberInput
            label="Starts at"
            value={Math.round(band.t0 * 100)}
            suffix="%"
            onCommit={(pct) => onEdit({ t0: pct / 100 })}
          />
          <NumberInput
            label="Ends at"
            value={Math.round(band.t1 * 100)}
            suffix="%"
            onCommit={(pct) => onEdit({ t1: pct / 100 })}
          />
        </>
      )}
      {/* only an m³ material bills on it: against paint or tile this box would
          move a number that never reaches the bill */}
      {row.unit === 'm3' && (
        <NumberInput
          label="Thickness"
          value={row.thickness}
          suffix="m"
          onCommit={(thickness) => onEdit({ thickness })}
        />
      )}
      {/* Build or strip out. Two named buttons rather than a switch, because
          neither one is "off" — they are two answers to what is happening to
          this layer, and a strip-out is priced against its own demo- code at
          its own rate. */}
      <div className="flex items-center justify-between gap-2 py-1">
        <Label>Work</Label>
        <ToggleButtonGroup
          size="sm"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[row.phase]}
          onSelectionChange={(keys) =>
            onPhase(keys.has('demolish') ? 'demolish' : 'new')
          }
        >
          <ToggleButton id="new">Build</ToggleButton>
          <ToggleButton id="demolish">Strip out</ToggleButton>
        </ToggleButtonGroup>
      </div>
    </div>
  );
}

import { Tabs } from '@heroui/react';
import { IconChevronDown, IconTrash } from '@tabler/icons-react';
import { DEMO_RATES, formatMoney } from '@/data/rates';
import type { FinishRow, StepSide } from './estimator-finishes';
import type { OpeningRow } from './estimator-openings';
import { FinishFields } from './estimator-fields';

/** one side of a shape, and what to call it on its tab */
export interface SideDef {
  readonly id: StepSide;
  readonly label: string;
}

/**
 * The two faces of a wall.
 *
 * "Side A" and "Side B" rather than "Inside"/"Outside" on purpose: the
 * estimator has no idea which face of a given wall faces out — an internal
 * partition has two insides — so those words would be a label that is
 * sometimes simply wrong. A and B name the two sides without claiming anything
 * about the world, and the plan behind the sheet says which is which, because
 * the shape being priced is lit up on it. What gets WRITTEN to the document is
 * core's own `face+`/`face-`, and `spotsFor` is the only place the two
 * vocabularies are ever put side by side.
 */
const WALL_SIDES: readonly SideDef[] = [
  { id: 'a', label: 'Side A' },
  { id: 'b', label: 'Side B' },
];

/**
 * The two surfaces of a room — which are the two surfaces of the slab under it.
 *
 * A room used to get one tab-less list, on the reasoning that a room is a
 * volume rather than a face and so has no second copy of its layers to hide
 * behind a tab. That was wrong in the way that matters to a bill: a floor
 * build-up and a ceiling build-up are different trades against different
 * surfaces of the same slab, and one list forced them into a single stack the
 * document then had to split again on the way out — or, worse, left the
 * ceiling unreachable.
 *
 * Unlike a wall's A and B, these two words are never wrong about the world:
 * which way is up is not something the estimator has to guess at.
 */
const ROOM_SIDES: readonly SideDef[] = [
  { id: 'floor', label: 'Floor' },
  { id: 'ceiling', label: 'Ceiling' },
];

/**
 * Which sides a kind of shape shows.
 *
 * Everything the walk turns up has exactly two, and the pair differs only in
 * what they are called: a wall is plastered on both faces and may be tiled on
 * one; a room is screeded underfoot and skimmed overhead. Kinds that can carry
 * no build-up at all never reach here — the sheet blocks on `blocked` first —
 * so this does not need a third answer.
 */
export function sidesFor(kind: string): readonly SideDef[] {
  return kind === 'room' ? ROOM_SIDES : WALL_SIDES;
}

/** the tab a step opens on, which is the first one it has */
export function defaultSide(kind: string): StepSide {
  return sidesFor(kind)[0].id;
}

/**
 * How one row on one side is keyed — for what is open, and for nothing else.
 *
 * The finish's own entity id is already unique across the whole drawing, so
 * the side is not strictly needed. It is in the key anyway because the open
 * set outlives a step and a bare entity id would say nothing about which face
 * it was opened on, which is exactly the sort of thing that reads fine until
 * two faces carry the same build-up.
 */
export function rowKey(side: StepSide, finishId: string): string {
  return `${side}.${finishId}`;
}

/** how a quantity is written, per the unit the material is priced in */
const UNIT_LABEL: Record<string, string> = {
  m: 'm',
  m2: 'm²',
  m3: 'm³',
  count: 'units',
};

/** two decimals, because that is what the bill of quantities will carry */
export function formatQuantity(quantity: number, unit: string): string {
  return `${quantity.toFixed(2)} ${UNIT_LABEL[unit] ?? unit}`;
}

/**
 * What a row's detail panel says — the facts, not a placeholder.
 *
 * This used to print prose that changed per layer, standing in for inputs that
 * did not exist. Both are real now: the finish is an entity on a real face,
 * its area comes back with the openings already subtracted, and the fields
 * under these facts change the band that area is measured over.
 *
 * The facts stay, above the controls, because they are what the controls are
 * being set AGAINST — a band is chosen by looking at what the face currently
 * measures, so reading it afterwards would be reading it too late.
 *
 * A pure function of the row so it can be asserted without a DOM.
 */
export function finishFacts(
  row: FinishRow,
): readonly { readonly label: string; readonly value: string }[] {
  const facts = [
    // net, and it says so: a wall with a window in it is the single most
    // common place an estimate goes wrong by the area of the window
    { label: 'Area', value: `${row.area.toFixed(2)} m² net of openings` },
  ];
  // only worth a line when it is not just the area again — a length material
  // (a trim, a skirting) is measured along the wall and nothing else
  if (row.unit === 'm') {
    facts.push({ label: 'Length', value: `${row.length.toFixed(2)} m` });
  }
  facts.push({
    label: 'Quantity',
    value: formatQuantity(row.quantity, row.unit),
  });
  facts.push({ label: 'Cost code', value: row.costCode });
  // the arithmetic spelled out, because a single total is a number to be
  // trusted and a rate times a quantity is a number that can be checked
  facts.push({
    label: 'Rate',
    value: row.priced
      ? `${formatMoney(row.priced.rate, DEMO_RATES.currency)} / ${row.unit === 'count' ? 'unit' : row.unit === 'm2' ? 'm²' : row.unit === 'm3' ? 'm³' : row.unit}`
      : `nobody has quoted ${row.costCode} yet`,
  });
  if (row.priced) {
    facts.push({
      label: 'Amount',
      value: formatMoney(row.priced.amount, DEMO_RATES.currency),
    });
  }
  if (row.unpriced) {
    facts.push({
      label: 'Note',
      value: 'No material on this one, so it prices as bare area.',
    });
  }
  return facts;
}

/**
 * One layer on the list: its place in the build-up, its name, and the two
 * things that can be done to it.
 *
 * The number is the order it went ON, which is what the document knows: a
 * finish carries no rank of its own, so the row counts creation order and
 * claims nothing more.
 *
 * Two icon-only targets in one 44 px row, and no third: the name is text, not
 * a button. A row that opened on any tap would put the destructive control
 * inside the target of the harmless one, which on a phone is how a build-up
 * gets deleted by a thumb aiming at a chevron.
 */
function LayerRow({
  row,
  number,
  open,
  onToggleDetail,
  onRemove,
  openings,
  onEdit,
  onDeduct,
  onDemolish,
  onDemolishOpening,
}: {
  row: FinishRow;
  /** its place in the build-up, printed first */
  number: number;
  open: boolean;
  onToggleDetail: () => void;
  onRemove: () => void;
  openings: readonly OpeningRow[];
  onEdit: (patch: Record<string, number>) => void;
  onDeduct: (deductOpenings: boolean) => void;
  onDemolish: (next: { width?: number; height?: number }) => void;
  onDemolishOpening: (openingId: string, demolish: boolean) => void;
}) {
  return (
    // a hairline between rows: now that a row carries a delete, where one row
    // ends and the next begins is the difference between removing 2 and 3
    <div className="border-b border-separator last:border-0">
      <div className="flex items-center gap-2">
        {/* tabular, so 9. and 10. put their names in the same column */}
        <span className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">
          {number}.
        </span>
        <span className="min-w-0 flex-1 truncate py-2.5 text-sm">
          {row.name}
        </span>
        {/* the quantity on the row itself, because it is the answer the sheet
            exists to give and opening every row to find it would be a tap per
            layer. The detail below breaks it down. */}
        {/* the quantity AND what it comes to. The quantity is the measurement
            and the money is the answer, and a row that showed only one of them
            would send the reader behind the chevron for the other on every
            single layer. */}
        <span className="flex shrink-0 flex-col items-end text-xs tabular-nums">
          <span className="text-muted">
            {formatQuantity(row.quantity, row.unit)}
          </span>
          <span className={row.priced ? '' : 'text-muted'}>
            {row.priced
              ? formatMoney(row.priced.amount, DEMO_RATES.currency)
              : 'no rate'}
          </span>
        </span>
        {/* the icons carry no text, and a bare "remove" would come out as a
            column of identical buttons to anyone not looking at it */}
        <button
          type="button"
          aria-label={`Remove ${row.name}`}
          onClick={onRemove}
          className="grid size-11 shrink-0 place-items-center text-muted"
        >
          <IconTrash size={16} />
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Details for ${row.name}`}
          onClick={onToggleDetail}
          className="grid size-11 shrink-0 place-items-center text-muted"
        >
          <IconChevronDown
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
            size={16}
          />
        </button>
      </div>
      {open && (
        // the facts first and the controls under them: what this layer already
        // measures is the thing the numbers below are being changed AGAINST,
        // so reading it after setting a band would be reading it too late
        <div className="px-1 pb-2 pr-11">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
            {finishFacts(row).map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-right">{fact.label}</dt>
                <dd className="tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
          <FinishFields
            row={row}
            openings={openings}
            onEdit={onEdit}
            onDeduct={onDeduct}
            onDemolish={onDemolish}
            onDemolishOpening={onDemolishOpening}
          />
        </div>
      )}
    </div>
  );
}

/** the layers on one side, or the reason there are none */
function SideLayers({
  rows,
  opened,
  side,
  onToggleDetail,
  onRemove,
  openings,
  onEdit,
  onDeduct,
  onDemolish,
  onDemolishOpening,
}: {
  rows: readonly FinishRow[];
  opened: ReadonlySet<string>;
  side: StepSide;
  onToggleDetail: (side: StepSide, finishId: string) => void;
  onRemove: (side: StepSide, finishId: string) => void;
  openings: readonly OpeningRow[];
  onEdit: (finishId: string, patch: Record<string, number>) => void;
  onDeduct: (finishId: string, deductOpenings: boolean) => void;
  onDemolish: (
    finishId: string,
    next: { width?: number; height?: number },
  ) => void;
  onDemolishOpening: (openingId: string, demolish: boolean) => void;
}) {
  if (rows.length === 0) {
    // Empty is the STARTING state, not a failure: nothing is priced until
    // somebody says what this face is built up from. So it says what to do
    // rather than reporting an absence — and the add row directly under it is
    // the thing it is pointing at.
    return (
      <p className="py-3 text-xs text-muted">
        Nothing here yet. Add the layers this is built up from.
      </p>
    );
  }
  return (
    // No cap and no scroller of its OWN. The sheet's height is capped at the
    // dialog (SHEET_MAX_HEIGHT), so the one scroller is the modal body: a
    // second one nested inside it meant two scrollable surfaces under one
    // thumb, where a drag that reached the end of the inner list did nothing.
    <ol className="text-left">
      {rows.map((row, at) => (
        <li key={row.id}>
          <LayerRow
            row={row}
            number={at + 1}
            open={opened.has(rowKey(side, row.id))}
            onToggleDetail={() => onToggleDetail(side, row.id)}
            onRemove={() => onRemove(side, row.id)}
            openings={openings}
            onEdit={(patch) => onEdit(row.id, patch)}
            onDeduct={(on) => onDeduct(row.id, on)}
            onDemolish={(next) => onDemolish(row.id, next)}
            onDemolishOpening={onDemolishOpening}
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * What the shape under the walk is built up from, face by face.
 *
 * Every row is a FINISH in the document — a real hosted entity on a real wall
 * face, whose area comes back with the openings already subtracted and whose
 * quantity is the one the bill of quantities will carry. It starts empty and
 * stays empty until the user says otherwise, because a build-up that has not
 * been stated is not a list of unticked rows, it is nothing at all.
 *
 * Fully controlled: which side is showing, what is on each side and what is
 * open are the wizard's, not this list's — and what is on each side is READ
 * from the document rather than held anywhere. That is what lets a test render
 * this at any state with no session, no dialog and no DOM to tap in.
 */
export function LayerList({
  kind,
  side,
  rows,
  opened,
  blocked,
  onSideChange,
  onToggleDetail,
  onRemove,
  onEdit,
  onDeduct,
  openings,
  onDemolish,
  onDemolishOpening,
}: {
  /** the `EstimatorStep.kind` being priced — decides how many sides it has */
  kind: string;
  /** the side showing now */
  side: StepSide;
  /** the finishes on each side, keyed by side id */
  rows: Readonly<Record<string, readonly FinishRow[]>>;
  /** the rows whose detail is showing, keyed by `rowKey` */
  opened: ReadonlySet<string>;
  /**
   * Why this shape cannot carry a build-up, when it cannot.
   *
   * Core hosts a finish on a wall face or a slab and nowhere else, so most of
   * what the walk turns up has nowhere to put one. Saying which and why beats
   * offering an Add button with nothing to dispatch — and it beats the old
   * behaviour, which was to let the user fill a list that was never going
   * anywhere.
   */
  blocked?: string;
  onSideChange: (side: StepSide) => void;
  onToggleDetail: (side: StepSide, finishId: string) => void;
  onRemove: (side: StepSide, finishId: string) => void;
  /** a width or height edit, already in FINISH.UPDATE's own vocabulary */
  onEdit: (finishId: string, patch: Record<string, number>) => void;
  /** whether the openings crossing this layer come out of its area */
  onDeduct: (finishId: string, deductOpenings: boolean) => void;
  /** the doors and windows in the shape being priced, for the strip-out boxes */
  openings: readonly OpeningRow[];
  /** the strip-out extent for one layer — a finish of its own in the document */
  onDemolish: (
    finishId: string,
    next: { width?: number; height?: number },
  ) => void;
  /** send one door or window to the bill as its own tear-out line */
  onDemolishOpening: (openingId: string, demolish: boolean) => void;
}) {
  if (blocked !== undefined) {
    return <p className="py-3 text-xs text-muted">{blocked}</p>;
  }

  const sides = sidesFor(kind);

  return (
    <div className="flex flex-col">
      <Tabs
        selectedKey={side}
        // the keys are the SideDef ids rendered just below, so narrowing
        // react-aria's widened Key back to StepSide cannot be wrong here
        onSelectionChange={(key) => onSideChange(String(key) as StepSide)}
      >
        {/* ListContainer is not optional chrome: without it HeroUI's TabList
            falls back to a bare RAC list with no pill behind it, which is what
            made the old bar read as two words floating over the sheet. It also
            brings the rounded `bg-default` track the selected pill slides in. */}
        <Tabs.ListContainer>
          {/* w-full beats the track's own `w-max`, and flex-1 on each tab
              splits it evenly — two options, half a phone each. Utilities win
              here because HeroUI's component CSS sits in @layer components and
              Tailwind's in @layer utilities, which is ordered after it. */}
          <Tabs.List aria-label="Sides" className="w-full">
            {sides.map((one) => (
              <Tabs.Tab key={one.id} id={one.id} className="flex-1">
                {/* the moving pill. It lives INSIDE the tab because that is
                    where react-aria reads `isSelected` from, and it animates
                    between them as a shared element — which is the whole
                    reason the bar reads as one control and not two buttons */}
                <Tabs.Indicator />
                {one.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {sides.map((one) => (
          // the panel's own `mt-4 p-2` is desktop spacing; on a sheet that is
          // half a phone tall it is a quarter of the list's height spent on air
          <Tabs.Panel key={one.id} id={one.id} className="mt-2 p-0">
            <SideLayers
              rows={rows[one.id] ?? []}
              opened={opened}
              side={one.id}
              onToggleDetail={onToggleDetail}
              onRemove={onRemove}
              openings={openings}
              onEdit={onEdit}
              onDeduct={onDeduct}
              onDemolish={onDemolish}
              onDemolishOpening={onDemolishOpening}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
}

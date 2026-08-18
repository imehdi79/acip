import { Button, Tabs } from '@heroui/react';
import { IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react';
import type { FinishRow } from './estimator-finishes';

/** one side of a shape, and what to call it on its tab */
export interface SideDef {
  readonly id: string;
  readonly label: string;
}

/**
 * A shape with two faces, and a shape with one.
 *
 * "Side A" and "Side B" rather than "Inside"/"Outside" on purpose: the
 * estimator has no idea which face of a given wall faces out — an internal
 * partition has two insides — so those words would be a label that is
 * sometimes simply wrong. A and B name the two sides without claiming anything
 * about the world, and the plan behind the sheet says which is which, because
 * the shape being priced is lit up on it. What gets WRITTEN to the document is
 * core's own `face+`/`face-`; the two vocabularies meet in `sideToFace`.
 */
const BOTH: readonly SideDef[] = [
  { id: 'a', label: 'Side A' },
  { id: 'b', label: 'Side B' },
];

/**
 * A room has ONE list and no tabs. A room is a volume, not a face — its layers
 * are the floor and the ceiling build-up, and there is no second copy of them
 * to put behind a tab. A tab bar with one tab in it is a control that cannot be
 * used, spending a row of a phone's screen to say nothing.
 */
const SINGLE: readonly SideDef[] = [{ id: 'a', label: 'Layers' }];

/**
 * Which sides a kind of shape has.
 *
 * Everything the walk turns up is two-sided except a room: a wall is plastered
 * on both faces and may be tiled on one, a door is painted differently each
 * side, a window has a board inside and a cill outside. So the rule is stated
 * as the exception it is.
 */
export function sidesFor(kind: string): readonly SideDef[] {
  return kind === 'room' ? SINGLE : BOTH;
}

/** the tab id the sheet uses → the face the document stores it against */
export function sideToFace(side: string): 'face+' | 'face-' {
  return side === 'b' ? 'face-' : 'face+';
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
export function rowKey(side: string, finishId: string): string {
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
 * did not exist. They still do not, but the NUMBERS do: the finish is a real
 * entity on a real face, and its area comes back with the openings already
 * subtracted. So the panel answers the two questions a row raises — how much
 * of it is there, and what will it be priced as — and phase two adds the
 * inputs that let those numbers be changed.
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
}: {
  row: FinishRow;
  /** its place in the build-up, printed first */
  number: number;
  open: boolean;
  onToggleDetail: () => void;
  onRemove: () => void;
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
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {formatQuantity(row.quantity, row.unit)}
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
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-1 pb-2 pr-22 text-xs text-muted">
          {finishFacts(row).map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-right">{fact.label}</dt>
              <dd className="tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
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
}: {
  rows: readonly FinishRow[];
  opened: ReadonlySet<string>;
  side: string;
  onToggleDetail: (side: string, finishId: string) => void;
  onRemove: (side: string, finishId: string) => void;
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
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * The way anything gets onto the list — the last row OF the list.
 *
 * A full-width row under the layers rather than an icon squeezed in beside the
 * tabs. Two things fall out of that. The tab bar gets the whole width, which is
 * what a two-option segmented control needs to be readable and to give each
 * option half a phone to be tapped in; and the one control that is useless to
 * miss stops being a 32 px square in a field of empty space.
 */
function AddRow({ onAdd }: { onAdd: () => void }) {
  return (
    <Button
      fullWidth
      variant="ghost"
      size="sm"
      onPress={onAdd}
      // a top hairline, so it lands as the row after the last layer rather than
      // as a button floating under a list
      className="mt-1 justify-start gap-2 border-t border-separator"
    >
      <IconPlus size={16} />
      Add layers
    </Button>
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
  onAdd,
}: {
  /** the `EstimatorStep.kind` being priced — decides how many sides it has */
  kind: string;
  /** the side showing now */
  side: string;
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
  onSideChange: (side: string) => void;
  onToggleDetail: (side: string, finishId: string) => void;
  onRemove: (side: string, finishId: string) => void;
  onAdd: () => void;
}) {
  if (blocked !== undefined) {
    return <p className="py-3 text-xs text-muted">{blocked}</p>;
  }

  const sides = sidesFor(kind);

  // One side: no tab bar at all, just the list and the row that fills it.
  if (sides.length === 1) {
    const only = sides[0];
    return (
      <div className="flex flex-col">
        <SideLayers
          rows={rows[only.id] ?? []}
          opened={opened}
          side={only.id}
          onToggleDetail={onToggleDetail}
          onRemove={onRemove}
        />
        <AddRow onAdd={onAdd} />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Tabs
        selectedKey={side}
        onSelectionChange={(key) => onSideChange(String(key))}
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
            />
          </Tabs.Panel>
        ))}
      </Tabs>
      <AddRow onAdd={onAdd} />
    </div>
  );
}

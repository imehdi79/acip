import { Button, Tabs } from '@heroui/react';
import { IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react';
import type { LayerOption } from '@/data/layers';

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
 * the shape being priced is lit up on it.
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
 * side, a window has a sill inside and a cill outside. So the rule is stated as
 * the exception it is, and a kind nobody has thought about yet gets two sides
 * rather than silently losing one.
 */
export function sidesFor(kind: string): readonly SideDef[] {
  return kind === 'room' ? SINGLE : BOTH;
}

/**
 * How one layer on one side is keyed — for what is open, and for nothing else.
 *
 * A layer can be on BOTH sides of the same wall (plaster usually is), so the
 * layer id alone would tie the two rows together and open them as one. Shared
 * by the list and by whoever owns the open set, so the two cannot drift into
 * keying the same row differently.
 */
export function rowKey(side: string, layerId: string): string {
  return `${side}.${layerId}`;
}

/**
 * What a layer's detail panel says.
 *
 * A PLACEHOLDER, and the seam the real thing arrives at. What belongs here is
 * inputs — a thickness for a plaster, a number of coats for a paint, a tile
 * size — and they differ per layer, which is exactly why this is a function of
 * the layer rather than a block of markup in the row. When the inputs land,
 * this is the only thing that changes and the row does not.
 *
 * It prints the layer's own description because that prose is otherwise only
 * visible in the add sheet: once a layer is on the list, the row is a name and
 * a number, and "what did I mean by Skim" has nowhere else to be answered.
 */
export function layerDetail(layer: LayerOption): string {
  return `${layer.description} Inputs for ${layer.label} land here.`;
}

/**
 * One layer on the list: its place in the build-up, its name, and the two
 * things that can be done to it.
 *
 * The number is a PRIORITY, not a decoration — layers go on in an order, and
 * render under skim under paint is a wall while the reverse is not. It is also
 * what makes the sheet sayable out loud: "take 2 off Side A" is a sentence a
 * column of anonymous rows cannot support.
 *
 * Two icon-only targets in one 44 px row, and no third: the name is text, not
 * a button. A row that opened on any tap would put the destructive control
 * inside the target of the harmless one, which on a phone is how a build-up
 * gets deleted by a thumb aiming at a chevron.
 */
function LayerRow({
  layer,
  number,
  open,
  onToggleDetail,
  onRemove,
}: {
  layer: LayerOption;
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
          {layer.label}
        </span>
        {/* the icons carry no text, and a bare "remove" would come out as a
            column of identical buttons to anyone not looking at it */}
        <button
          type="button"
          aria-label={`Remove ${layer.label}`}
          onClick={onRemove}
          className="grid size-11 shrink-0 place-items-center text-muted"
        >
          <IconTrash size={16} />
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Details for ${layer.label}`}
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
        // inside the row, inside the scroller below: opening a detail must
        // lengthen the LIST and not the sheet, because the sheet is parked over
        // the shape it is describing
        <p className="px-1 pb-2 pr-22 text-xs text-muted">
          {layerDetail(layer)}
        </p>
      )}
    </div>
  );
}

/** the layers on one side, or the reason there are none */
function SideLayers({
  layers,
  opened,
  side,
  onToggleDetail,
  onRemove,
}: {
  layers: readonly LayerOption[];
  opened: ReadonlySet<string>;
  side: string;
  onToggleDetail: (side: string, layerId: string) => void;
  onRemove: (side: string, layerId: string) => void;
}) {
  if (layers.length === 0) {
    // Empty is the STARTING state, not a failure: nothing is priced until
    // somebody says what this is built up from. So it says what to do rather
    // than reporting an absence — and the add row directly under it is the
    // thing it is pointing at.
    return (
      <p className="py-3 text-xs text-muted">
        Nothing here yet. Add the layers this is built up from.
      </p>
    );
  }
  return (
    // No cap and no scroller of its OWN any more. The sheet's height is now
    // capped at the dialog (see SHEET_MAX_HEIGHT), so the one scroller is the
    // modal body: a second one nested inside it meant two scrollable surfaces
    // under one thumb, where a drag that reached the end of the inner list did
    // nothing instead of moving the sheet.
    <ol className="text-left">
      {layers.map((layer, at) => (
        <li key={layer.id}>
          <LayerRow
            layer={layer}
            number={at + 1}
            open={opened.has(rowKey(side, layer.id))}
            onToggleDetail={() => onToggleDetail(side, layer.id)}
            onRemove={() => onRemove(side, layer.id)}
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
 * miss stops being a 32 px square in a field of empty space. It reads as the
 * list continuing — which is exactly what pressing it does.
 *
 * It sits OUTSIDE the tab panels, because it acts on whichever side is showing
 * and one button that follows the tabs is the honest shape of that. It is also
 * the reason the empty state can be a single line: what to do about it is the
 * row directly underneath.
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
 * What the shape under the walk is built up from, side by side.
 *
 * It starts EMPTY and stays empty until the user says otherwise. This used to
 * be a book of rates arriving pre-listed with tick-boxes against them, which
 * put a list of things on screen that nobody had said were true of this shape;
 * a build-up that has not been stated is not a list of unticked rows, it is
 * nothing at all.
 *
 * Fully controlled: which side is showing, what is on each side and what is
 * open are all the wizard's state, not this list's. That is what makes "does
 * the build-up survive Next" a decision taken once, in the open, rather than a
 * side effect of what React happens to remount — and it is what lets a test
 * render this at any state with no dialog, no session and no DOM to tap in.
 */
export function LayerList({
  kind,
  side,
  lists,
  opened,
  onSideChange,
  onToggleDetail,
  onRemove,
  onAdd,
}: {
  /** the `EstimatorStep.kind` being priced — decides how many sides it has */
  kind: string;
  /** the side showing now */
  side: string;
  /** what is on each side, keyed by side id */
  lists: Readonly<Record<string, readonly LayerOption[]>>;
  /** the rows whose detail is showing, keyed by `rowKey` */
  opened: ReadonlySet<string>;
  onSideChange: (side: string) => void;
  onToggleDetail: (side: string, layerId: string) => void;
  onRemove: (side: string, layerId: string) => void;
  onAdd: () => void;
}) {
  const sides = sidesFor(kind);

  // One side: no tab bar at all, just the list and the row that fills it.
  if (sides.length === 1) {
    const only = sides[0];
    return (
      <div className="flex flex-col">
        <SideLayers
          layers={lists[only.id] ?? []}
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
              layers={lists[one.id] ?? []}
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

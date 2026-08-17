import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Checkbox, Label, Modal } from '@heroui/react';
import {
  IconArrowsMaximize,
  IconCalculator,
  IconChevronDown,
  IconFocusCentered,
} from '@tabler/icons-react';
import type { BBox } from '@acip/editor-core';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import type { FitBounds } from '@/editor/ui-state';
import {
  buildFor,
  loadBuilds,
  loadPrices,
  pricesFor,
  type BuildBook,
  type BuildItem,
  type PriceBook,
} from '@/data/prices';
import { estimatorSteps } from './estimator-steps';

/**
 * The share of the plan left CLEAR by the sheet at the bottom.
 *
 * A step now carries a build item with a picker under it and a capped list of
 * rates, so the sheet lands around 350 px of a ~740 px phone — call it half.
 * It used to be one line and a counter at 0.6; the number came down when the
 * sheet grew, because the whole point of the framing is that the shape being
 * priced stays above it. The rest is slack for a long room name, the footer the
 * sheet sits over, and the phone's own bottom inset.
 */
const CLEAR_FRACTION = 0.5;

/**
 * Nothing is framed tighter than this, in meters. A 0.9 m door fitted on its
 * own fills the screen with a door and no plan around it — a name with no
 * context, which is the very thing the camera is here to fix. Four meters
 * keeps whatever it is hosted in on screen with it.
 */
const MIN_SPAN = 4;

/**
 * The box to hand `requestFit` so the shape lands ABOVE the sheet.
 *
 * The viewport centers whatever it is given in the WHOLE canvas, so a box that
 * is honest about the shape puts it dead center — behind the sheet. The padding
 * is therefore asymmetric on purpose: the box grows DOWNWARD only (world is
 * Y-up, so -Y is the edge the sheet covers) by the share of the screen the
 * sheet takes.
 *
 * Two things fall out of one number. Fitting `h / CLEAR_FRACTION` in the full
 * canvas is the same zoom as fitting `h` in the clear band alone, and the
 * padded box's center sits half the skirt below the shape's — which lifts the
 * shape by exactly that much, into the clear part of the screen.
 */
function framing(bounds: BBox): FitBounds {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const w = Math.max(bounds.maxX - bounds.minX, MIN_SPAN);
  const h = Math.max(bounds.maxY - bounds.minY, MIN_SPAN);
  const skirt = (h * (1 - CLEAR_FRACTION)) / CLEAR_FRACTION;
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: cy - h / 2 - skirt,
    maxY: cy + h / 2,
  };
}

/**
 * One tickable line of the estimate — a rate, or the build item above them.
 *
 * Shared rather than written twice, because the build item is not a special
 * kind of row: it is the same tick, the same chevron and the same detail, with
 * a picker under it instead of a rate against it. Anything that changes about
 * how a line behaves changes for all of them at once.
 *
 * Two gestures, two targets: the tick says "this one is in", the chevron alone
 * opens the prose. One tap doing both would make the detail impossible to
 * refuse — every tick on a thirty-shape walk would spend sheet height on words
 * nobody asked for, and those pixels come straight off the drawing. Two targets
 * in one 44 px row is a real cost on a phone, and it is paid by making them
 * wildly unequal: the tick takes all the width the chevron does not, and the
 * chevron is a 44 px square pinned to the trailing edge, under the thumb.
 */
function ItemRow({
  label,
  number,
  trailing,
  detail,
  checked,
  open,
  onCheck,
  onToggleDetail,
  children,
}: {
  label: string;
  /** its place in the list, printed before the tick; the build item has none */
  number?: number;
  /** the rate, for a rate row */
  trailing?: ReactNode;
  detail?: string;
  checked: boolean;
  open: boolean;
  onCheck: (checked: boolean) => void;
  onToggleDetail: () => void;
  /** anything the row owns below its own line — the build item's picker */
  children?: ReactNode;
}) {
  return (
    // a hairline between rows: now that a row is a target, where one ends and
    // the next begins is the difference between ticking Plaster and Paint
    <div className="border-b border-separator last:border-0">
      <div className="flex items-center gap-2">
        {number !== undefined && (
          // tabular, so 9. and 10. put their ticks in the same column
          <span className="w-4 shrink-0 text-right text-xs text-muted tabular-nums">
            {number}.
          </span>
        )}
        <Checkbox
          isSelected={checked}
          onChange={onCheck}
          className="min-w-0 flex-1 py-2.5"
        >
          <Checkbox.Content className="min-w-0 gap-2">
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label className="min-w-0 flex-1 truncate">{label}</Label>
            {trailing}
          </Checkbox.Content>
        </Checkbox>
        <button
          type="button"
          aria-expanded={open}
          // the icon carries no text, and a bare "expand" would come out as a
          // row of identical buttons to anyone not looking at it
          aria-label={`Details for ${label}`}
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
        // A line with no prose is a normal answer too, the same way a kind with
        // no rates is: the book is a seam onto a server that may hold numbers
        // and nothing else. Saying so beats opening a row onto a blank strip,
        // which reads as a bug in the sheet.
        <p className="px-1 pb-2 pr-11 text-xs text-muted">
          {detail ?? 'No note on this one yet.'}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * What the shape is BUILT FROM — the estimate's first line, and the only one
 * that is a choice rather than a tick.
 *
 * It stands OUTSIDE the rate list on purpose. Brick or block is not another
 * item to add up; it decides what "Blockwork, 48.00 / m²" even means, so a
 * numbered place among the rates would read as one more line of the same kind.
 * Above them, unnumbered, it reads as what it is: the thing they hang off.
 *
 * The picker is a native <select>, alone among the controls in this app. On a
 * phone that is the OS wheel — one thumb, no popover to place over a sheet that
 * is already parked over the drawing — and the sheet cannot afford a second
 * layer above itself.
 */
export function Build({
  item,
  checked,
  open,
  option,
  onCheck,
  onToggleDetail,
  onPick,
}: {
  /** null while the book is coming, or for a kind nobody has described */
  item: BuildItem | null;
  checked: boolean;
  open: boolean;
  /** the chosen option id, or '' for none yet */
  option: string;
  onCheck: (checked: boolean) => void;
  onToggleDetail: () => void;
  onPick: (optionId: string) => void;
}) {
  if (!item) return null;
  return (
    <ItemRow
      label={item.label}
      detail={item.detail}
      checked={checked}
      open={open}
      onCheck={onCheck}
      onToggleDetail={onToggleDetail}
    >
      <select
        aria-label={item.label}
        value={option}
        onChange={(e) => onPick(e.target.value)}
        className="mb-2 w-full rounded-sm border border-separator bg-surface px-2 py-2 text-sm"
      >
        {/* an explicit empty choice, because nothing chosen is the honest
            starting state: defaulting to the first option would have the sheet
            claim the user said "brick" when they have said nothing at all */}
        <option value="">Choose…</option>
        {item.options.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </ItemRow>
  );
}

/**
 * The rates for the shape under the walk, as a numbered list of tick-boxes.
 *
 * A list, and nothing more: no quantities, no arithmetic, no totals. What a
 * 4.65 m wall costs needs the takeoff as well as the rate, and putting a number
 * on the screen before that arithmetic exists would be inventing one. A rate
 * can be TICKED and it can be OPENED, and neither does any sums.
 *
 * Ticks rather than one pick, because an estimate is not a choice between the
 * rates: a wall is blockwork AND plaster AND paint. The numbers are there so
 * the sheet can be read back to somebody — "we have got 1 and 3" — which a
 * column of anonymous ticks cannot be.
 *
 * A kind with no rates is a normal answer — the walk covers stairs and slabs
 * too — so it says so rather than showing an empty box.
 *
 * Fully controlled: what is ticked and what is open are ShapeWizard's state,
 * not this list's. That is what makes "does the tick survive Next" a decision
 * taken once, in the open, rather than a side effect of what React happens to
 * remount — and it is what lets a test render this list at any state at all
 * with no dialog, no session and no DOM to tap in. Exported for that reason,
 * the same reason ShapeWizard is split out of Estimator.
 */
export function Rates({
  book,
  kind,
  checked,
  opened,
  onCheck,
  onToggleDetail,
}: {
  book: PriceBook | null;
  kind: string;
  /** the rate ids the user has ticked */
  checked: ReadonlySet<string>;
  /** the rate ids whose detail line is showing */
  opened: ReadonlySet<string>;
  onCheck: (id: string, checked: boolean) => void;
  onToggleDetail: (id: string) => void;
}) {
  if (!book) return <p className="text-xs text-muted">Loading rates…</p>;
  const rates = pricesFor(book, kind);
  if (rates.length === 0) {
    return <p className="text-xs text-muted">No rates for this yet.</p>;
  }
  return (
    // capped and scrollable: the sheet sits over the plan it is describing, and
    // a long list would push the drawing off the screen. Every open detail is
    // another line, so the detail sits INSIDE the row, inside this scroller.
    // Open all three and the list scrolls; the sheet does not gain a pixel and
    // the plan does not move.
    <ol className="max-h-32 overflow-y-auto text-left text-sm">
      {rates.map((rate, at) => (
        <li key={rate.id}>
          <ItemRow
            label={rate.label}
            number={at + 1}
            detail={rate.detail}
            checked={checked.has(rate.id)}
            open={opened.has(rate.id)}
            onCheck={(on) => onCheck(rate.id, on)}
            onToggleDetail={() => onToggleDetail(rate.id)}
            trailing={
              <span className="shrink-0 text-muted tabular-nums">
                {rate.rate.toFixed(2)} / {rate.unit}
              </span>
            }
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * The wizard: one shape at a time, first to last, so nothing in the plan is
 * priced by accident or missed. Only the name for now — the step is the frame
 * that the quantities and the rate for each shape go into next.
 *
 * Its own component, rendered inside the dialog rather than beside the trigger
 * button: the list is derived from the whole document (rooms alone re-run the
 * wall arrangement), so it must not be computed while the modal sits closed in
 * the footer. That also keeps the session out of <Estimator/>'s own render.
 */
function ShapeWizard({ close }: { close: () => void }) {
  const session = useSession();
  const { ui } = useRuntime();
  const levelId = ui.activeLevelId.get();
  // Taken once per opening. A see-through backdrop is still a backdrop: it is
  // a fixed, full-screen element above the canvas, so the plan can be read but
  // not touched while the sheet is up and the drawing cannot change underfoot.
  // The camera can therefore trust an index into this list.
  const steps = useMemo(
    () => estimatorSteps(session.doc, levelId),
    [session, levelId],
  );
  const [index, setIndex] = useState(0);
  /**
   * Frame the WHOLE drawing instead of the shape.
   *
   * Close on the shape is the right default — the walk is about one shape at a
   * time — but a wall filling the screen is a wall with nothing around it, and
   * "which one of these is W7" is a question only the rest of the plan answers.
   *
   * It is a MODE, not a one-off button: it survives Next and Back, because
   * someone reading the plan in context wants to stay in context, and having to
   * press it again on every step would make it useless for exactly the walk it
   * is meant to help with. In this framing the selection colour is all that
   * says which shape is being named, which is why the step effect below sets
   * the selection either way.
   */
  const [wholePlan, setWholePlan] = useState(false);
  /** the books, once they arrive; null while they are still coming */
  const [prices, setPrices] = useState<PriceBook | null>(null);
  const [builds, setBuilds] = useState<BuildBook | null>(null);
  /**
   * What is ticked, what is open, and what each build item is set to.
   *
   * All three live HERE, above `index`, so all three SURVIVE Next and Back. The
   * wizard remounts nothing between steps, so that is also what React would do
   * on its own — it is written down because it is the answer, not because it is
   * the default. Thirty walls in a row are almost always the same blockwork,
   * and making the user say so thirty times is thirty taps to state one fact.
   *
   * Carrying it is safe because every id is namespaced by kind (`wall.block`,
   * `room.screed`, `wall.built`): cross from the walls into the rooms and
   * nothing in the new list matches, so it simply arrives with nothing ticked
   * rather than quietly pricing a floor as blockwork.
   *
   * Ticks and open rows are SETS, not single values. For the ticks that is the
   * point — a wall is blockwork and plaster and paint. For the open rows it is
   * because an accordion exists to stop a list growing without bound and the
   * cap on the list already does that; with that reason gone, the only question
   * left is whether closing one row to open another ever helps, and comparing
   * what two rates cover is precisely why anyone opens them.
   */
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [builtFrom, setBuiltFrom] = useState<Readonly<Record<string, string>>>(
    {},
  );

  // Fetched once per opening, not once per step: the books cover every kind,
  // and asking again on Next would be a request per tap. The flag is not
  // ceremony — this sheet can be closed before a promise settles, and setting
  // state on a wizard that is gone is a warning at best.
  useEffect(() => {
    let live = true;
    void loadPrices().then((book) => {
      if (live) setPrices(book);
    });
    void loadBuilds().then((book) => {
      if (live) setBuilds(book);
    });
    return () => {
      live = false;
    };
  }, []);

  /** flip one id in a set of ids, for the ticks and for the open rows alike */
  const toggle = (
    set: ReadonlySet<string>,
    id: string,
    on = !set.has(id),
  ): ReadonlySet<string> => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  const step = steps[index];
  const last = index >= steps.length - 1;

  // The walk BORROWS the selection to highlight with, and gives it back.
  //
  // Declared before the step effect so it captures what the user had before
  // that one overwrites it — effects run in order. Handing back the original
  // beats clearing: the walk should cost nothing, and it must not leave the
  // footer holding whatever shape it happened to stop on, which on a locked
  // plan would be a shape the user is not allowed to edit at all.
  useEffect(() => {
    const before = session.selection.list();
    return () => {
      session.selection.clear();
      for (const id of before) session.selection.add(id);
    };
  }, [session]);

  // On the step and on the framing, and on nothing else: opening, Next, Back
  // and the toggle move the camera and light up the shape, a re-render does
  // neither. Anything else and a plan the user had panned or pinched to read
  // would be yanked back under them.
  //
  // Selecting is what makes the camera legible: framing a stretch of plan says
  // "somewhere around here", while the selection colour says "this one" — and
  // on a wall standing in a row of identical walls that is the whole answer.
  useEffect(() => {
    if (!step) return;
    session.selection.clear();
    for (const id of step.entityIds) session.selection.add(id);
    // no argument = the whole drawing, worked out by the viewport from what is
    // actually visible. No skirt here on purpose: the plan is being shown whole
    // and a shape near its bottom edge may sit under the sheet, but padding the
    // frame down would shrink the very thing this mode is for.
    if (wholePlan) {
      ui.requestFit();
      return;
    }
    const { minX, minY, maxX, maxY } = step.bounds;
    // a shape with no geometry gives the camera nowhere to go; leaving the plan
    // where it is beats sending the viewport to NaN
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
    ui.requestFit(framing(step.bounds));
  }, [session, ui, step, wholePlan]);

  return (
    <>
      {/* The shape being priced is the HEADING, and the counter the line above
          it. Both used to sit in the body, where they were two more lines
          competing with the items for the height the drawing is giving up — and
          where the one thing every row refers to scrolled away with the rows.
          In the header it stands still while the list moves under it, which is
          what a heading is for. */}
      <Modal.Header>
        <p className="text-xs text-muted">
          Estimator{step && ` · ${index + 1} of ${steps.length}`}
        </p>
        <Modal.Heading>{step ? step.name : 'Nothing to price'}</Modal.Heading>
      </Modal.Header>
      <Modal.Body className="flex flex-col gap-1 text-left">
        {step ? (
          <>
            {/* first, and outside the list: what it is made of decides what the
                rates under it mean */}
            <Build
              item={builds ? buildFor(builds, step.kind) : null}
              checked={checked.has(`${step.kind}.built`)}
              open={opened.has(`${step.kind}.built`)}
              option={builtFrom[`${step.kind}.built`] ?? ''}
              onCheck={(on) =>
                setChecked((ids) => toggle(ids, `${step.kind}.built`, on))
              }
              onToggleDetail={() =>
                setOpened((rows) => toggle(rows, `${step.kind}.built`))
              }
              // choosing what it is built from is saying it is part of the
              // estimate, so the tick follows the choice rather than making the
              // user say the same thing twice
              onPick={(optionId) => {
                const id = `${step.kind}.built`;
                setBuiltFrom((at) => ({ ...at, [id]: optionId }));
                setChecked((ids) => toggle(ids, id, optionId !== ''));
              }}
            />
            <Rates
              book={prices}
              kind={step.kind}
              checked={checked}
              opened={opened}
              onCheck={(id, on) => setChecked((ids) => toggle(ids, id, on))}
              onToggleDetail={(id) => setOpened((rows) => toggle(rows, id))}
            />
          </>
        ) : (
          <p className="text-sm text-muted">
            Nothing to price on this level yet.
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="flex justify-between gap-2">
        {/* the camera control shares the row with Close instead of taking one
            of its own: the sheet is parked over the plan it is describing, so a
            second row would cost more drawing than the button is worth */}
        <div className="flex gap-2">
          <Button variant="ghost" onPress={close}>
            Close
          </Button>
          {step && (
            <Button
              isIconOnly
              aria-label={
                wholePlan ? 'Showing the whole plan' : 'Show the whole plan'
              }
              aria-pressed={wholePlan}
              // filled accent against the sheet's ghost buttons when on: which
              // framing you are in is the one thing this button has to say, and
              // the icon says it twice — the shape in a frame, or the plan
              // pushed out to its corners
              variant={wholePlan ? 'primary' : 'ghost'}
              onPress={() => setWholePlan((on) => !on)}
            >
              {wholePlan ? <IconArrowsMaximize /> : <IconFocusCentered />}
            </Button>
          )}
        </div>
        {step && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              isDisabled={index === 0}
              onPress={() => setIndex((at) => Math.max(0, at - 1))}
            >
              Back
            </Button>
            {/* the end of the walk is the absence of a next step, not a dead
                button that says there is one */}
            {!last && (
              <Button
                onPress={() =>
                  setIndex((at) => Math.min(steps.length - 1, at + 1))
                }
              >
                Next
              </Button>
            )}
          </div>
        )}
      </Modal.Footer>
    </>
  );
}

/**
 * The estimator: what the drawing costs.
 *
 * The button alone lives out here. Everything that reads the session is inside
 * the dialog, which does not render until it opens — the footer mounts this in
 * a ButtonGroup, where it must stay a bare <button> and nothing more.
 *
 * `defaultOpen` and `onOpenChange` exist for the modes menu, which opens the
 * dialog by mounting this already open: an estimate picked from a menu should
 * arrive, not leave a second button to find. They are the Modal's own props,
 * passed straight through, so the button keeps working as a plain trigger when
 * nobody passes them.
 */
export function Estimator({
  defaultOpen,
  onOpenChange,
}: {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  return (
    <Modal defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <Button
        isIconOnly
        aria-label="Estimator"
        variant="tertiary"
        className="text-foreground"
      >
        <IconCalculator />
      </Button>
      {/* A reading aid, not a blocking dialog: the default backdrop is opaque
          (--backdrop, black at 50-56%), which greys out the very shape the
          wizard is naming. The variant picks the transparent class and the
          utility pins it, so no later default or theme can wash the plan out
          again — the whole feature is being able to SEE the shape. */}
      <Modal.Backdrop variant="transparent" className="bg-transparent!">
        {/* bottom, so the plan above it stays clear — see framing() */}
        <Modal.Container placement="bottom">
          <Modal.Dialog>
            {({ close }: { close: () => void }) => (
              <ShapeWizard close={close} />
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

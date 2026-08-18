import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  IconArrowsMaximize,
  IconCalculator,
  IconFocusCentered,
} from '@tabler/icons-react';
import type { BBox } from '@acip/editor-core';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import type { FitBounds } from '@/editor/ui-state';
import type { LayerOption } from '@/data/layers';
import { estimatorSteps } from './estimator-steps';
import { LayerList, rowKey, sidesFor } from './estimator-layers';
import { AddLayersSheet } from './estimator-add-layers';

/**
 * The share of the plan left CLEAR by the sheet at the bottom.
 *
 * A step carries a row of side tabs and a list of layers under them, so the
 * sheet lands around half of a ~740 px phone. It used to be one line and a
 * counter at 0.6; the number came down when the sheet grew, because the whole
 * point of the framing is that the shape being priced stays above it.
 */
export const CLEAR_FRACTION = 0.5;

/**
 * The tallest the sheet may ever be — the other half of `CLEAR_FRACTION`.
 *
 * This is not decoration, it is the framing contract made ENFORCEABLE. Every
 * camera box `framing()` builds assumes the sheet covers exactly
 * `1 - CLEAR_FRACTION` of the screen; nothing used to hold it to that. The
 * dialog's own rule is `max-h-full`, which is 100% of a container sized by
 * `--visual-viewport-height` — a value react-aria recomputes from the visual
 * viewport, so it moves when a keyboard opens. The add sheet stacked on top has
 * a search field in it, which is exactly how a keyboard gets opened over this
 * sheet, and the estimator came back from it able to grow to the full screen —
 * at which point the framing above it is describing a layout that no longer
 * exists.
 *
 * So the cap is stated in `svh` — the SMALL viewport height, which is fixed to
 * the largest browser chrome and does not move with a keyboard or a URL bar —
 * and applied as an inline style, which no layer, class or variant can lose to.
 * Derived from the constant rather than written as `50svh`, so the framing math
 * and the sheet cannot drift apart.
 */
export const SHEET_MAX_HEIGHT = `${(1 - CLEAR_FRACTION) * 100}svh`;

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

/** what one shape in the walk has been said to be built up from */
interface ShapeLayers {
  /** the side showing now — a side id from `sidesFor` */
  readonly side: string;
  /** the layers on each side, in the order they go on, keyed by side id */
  readonly lists: Readonly<Record<string, readonly LayerOption[]>>;
  /** the rows whose detail is showing, keyed by `rowKey` */
  readonly opened: ReadonlySet<string>;
}

/**
 * A shape nobody has said anything about yet — which is every shape, until it
 * is. Shared rather than built per read so that "has this one been touched"
 * stays a question about the map's keys and not about deep equality, and so
 * that arriving at a shape does not itself write an entry for it.
 *
 * Side `a` is the one showing, and it is the only side a one-sided shape has;
 * `sidesFor` names both of them starting there, so this is the first tab in
 * either case.
 */
const NO_LAYERS: ShapeLayers = { side: 'a', lists: {}, opened: new Set() };

/** the same set without one key, or the same set when it never had it */
function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}

/**
 * What to call the side being added to, or null for a shape with only one.
 *
 * Null rather than "Layers": the add sheet uses it to say WHICH side it is
 * about, and on a room there is no which — a heading answering a question the
 * user was never asked reads as a distinction they have missed.
 */
function sideLabel(kind: string, side: string): string | null {
  const sides = sidesFor(kind);
  if (sides.length === 1) return null;
  return sides.find((one) => one.id === side)?.label ?? null;
}

/**
 * The wizard: one shape at a time, first to last, so nothing in the plan is
 * priced by accident or missed. Each step names a shape and holds what it is
 * built up from — the frame the quantities and the rates go into next.
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
  /**
   * Every shape's build-up, keyed by the step's own id.
   *
   * PER SHAPE, not per kind. A wall's build-up is a fact about that wall — the
   * one facing the street is rendered and the one in the hall is not — so the
   * walk must not arrive at W8 already claiming it is built like W7. It lives
   * HERE, above `index`, so it survives Next and Back: the answer given on W7
   * is still there when the walk comes back to it, which is what makes Back
   * worth pressing at all.
   *
   * Keyed by `step.id`, which is the entity id, or the space key for a room —
   * stable for as long as the sheet is open, because the plan cannot change
   * underneath it (see `steps` above).
   */
  const [byShape, setByShape] = useState<Readonly<Record<string, ShapeLayers>>>(
    {},
  );
  /** whether the fullscreen add sheet is up over the wizard */
  const [adding, setAdding] = useState(false);

  const step = steps[index];
  const last = index >= steps.length - 1;
  const shape = (step && byShape[step.id]) ?? NO_LAYERS;

  /** rewrite one shape's build-up, leaving every other shape alone */
  const editShape = (id: string, change: (was: ShapeLayers) => ShapeLayers) =>
    setByShape((all) => ({ ...all, [id]: change(all[id] ?? NO_LAYERS) }));

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
          <LayerList
            kind={step.kind}
            side={shape.side}
            lists={shape.lists}
            opened={shape.opened}
            onSideChange={(side) =>
              editShape(step.id, (was) => ({ ...was, side }))
            }
            onToggleDetail={(side, layerId) =>
              editShape(step.id, (was) => {
                const key = rowKey(side, layerId);
                const rows = new Set(was.opened);
                if (!rows.delete(key)) rows.add(key);
                return { ...was, opened: rows };
              })
            }
            onRemove={(side, layerId) =>
              editShape(step.id, (was) => ({
                ...was,
                lists: {
                  ...was.lists,
                  [side]: (was.lists[side] ?? []).filter(
                    (layer) => layer.id !== layerId,
                  ),
                },
                // and take its detail row with it, or the set keeps a key for a
                // row that no longer exists — which comes back open the day the
                // same layer is added again
                opened: without(was.opened, rowKey(side, layerId)),
              }))
            }
            onAdd={() => setAdding(true)}
          />
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
      {step && (
        // Over the wizard, not beside it: the add sheet is full screen, so
        // while it is up there is no Next to press and the shape it saves onto
        // cannot change under it. Closed, it renders nothing at all.
        <AddLayersSheet
          kind={step.kind}
          sideLabel={sideLabel(step.kind, shape.side)}
          isOpen={adding}
          alreadyIn={
            new Set((shape.lists[shape.side] ?? []).map((layer) => layer.id))
          }
          onOpenChange={setAdding}
          // appended, not merged in catalogue order: the list is a build-up and
          // its numbers are the order things go on, so a layer added later goes
          // on later. The sheet already refuses what is on the side, so nothing
          // here can arrive twice.
          onSave={(layers) =>
            editShape(step.id, (was) => ({
              ...was,
              lists: {
                ...was.lists,
                [was.side]: [...(was.lists[was.side] ?? []), ...layers],
              },
            }))
          }
        />
      )}
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
          {/* the cap that keeps the plan visible whatever the sheet holds */}
          <Modal.Dialog style={{ maxHeight: SHEET_MAX_HEIGHT }}>
            {({ close }: { close: () => void }) => (
              <ShapeWizard close={close} />
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

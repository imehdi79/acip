import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  IconArrowsMaximize,
  IconCalculator,
  IconFocusCentered,
  IconPlus,
} from '@tabler/icons-react';
import type {
  BBox,
  DrawingDocument,
  EntityId,
  Material,
  MaterialId,
} from '@acip/editor-core';
import { WallEntity } from '@acip/editor-core';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import type { FitBounds } from '@/editor/ui-state';
import { estimatorSteps, type EstimatorStep } from './estimator-steps';
import { LayerList, defaultSide, rowKey, sidesFor } from './estimator-layers';
import {
  clearSpan,
  coverPatch,
  finishTargetFor,
  finishesAt,
  spotsFor,
  spotsToWrite,
  type FinishRow,
  type FinishTarget,
  type StepSide,
} from './estimator-finishes';
import { openingsAt, type OpeningRow } from './estimator-openings';
import {
  AddLayersSheet,
  LayerSheet,
  type ManualLayer,
} from './estimator-add-layers';
import { ReviewSheet, reviewSteps } from './estimator-review';
import { currentRates, demoCodeFor, setManualRate } from '@/data/rates';

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

/**
 * Which side of each shape is showing, keyed by the step's id.
 *
 * This is all the per-shape state the wizard still holds. What each side is
 * BUILT UP FROM used to live here too; it lives in the document now, as finish
 * entities on real wall faces, so it persists, undoes and feeds the bill of
 * quantities instead of dying when the sheet closes.
 *
 * Which tab is open is not that: it is where the user is looking, which no
 * drawing should carry. Per shape rather than one value because walking from a
 * wall whose Side B you were reading to the next wall should not silently move
 * you to a face you never chose.
 */
type OpenSides = Readonly<Record<string, StepSide>>;

/** everything the sheet reads out of the drawing for the step it is on */
interface DocView {
  /** the finishes on each surface, keyed by side id */
  readonly rows: Readonly<Record<string, readonly FinishRow[]>>;
  /** the drawing's own catalogue — what a surface can be built up from */
  readonly materials: readonly Material[];
  /** the doors and windows in the shape, keyed by side id */
  readonly openings: Readonly<Record<string, readonly OpeningRow[]>>;
}

/** nothing read yet, and what a step with nowhere to host a finish shows */
const NOTHING_READ: DocView = { rows: {}, materials: [], openings: {} };

/** the same set without one key, or the same set when it never had it */
function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}

/**
 * Read one step's build-up out of the document.
 *
 * BOTH surfaces, not just the one showing: the tabs render both panels, and
 * the add sheet has to know what is already on the live one so it can refuse
 * to apply the same material twice.
 *
 * It goes through `spotsFor`, which is the READ-ONLY half of the spot table —
 * a room whose floor has never been laid yields no spots and therefore no
 * rows, which is the honest answer. The half that would lay one is only
 * reached from Save. Nothing is created by looking at a room.
 *
 * A free function over the document, so what the sheet shows for a given
 * drawing can be asserted without React, a dialog or a DOM — the same reason
 * `estimatorSteps` is one.
 */
function readDoc(
  doc: DrawingDocument,
  step: EstimatorStep | undefined,
  target: FinishTarget | null,
): DocView {
  const materials = doc.materials.list();
  if (!step || !target) return { rows: {}, materials, openings: {} };
  const spots = spotsFor(target);
  const rows: Record<string, readonly FinishRow[]> = {};
  const openings: Record<string, readonly OpeningRow[]> = {};
  for (const one of sidesFor(step.kind)) {
    const spot = spots[one.id];
    rows[one.id] = spot ? finishesAt(doc, spot) : [];
    openings[one.id] = spot ? openingsAt(doc, spot) : [];
  }
  return { rows, materials, openings };
}

/** what to call the surface being added to — "Side B", "Ceiling" */
function sideLabel(kind: string, side: StepSide): string | null {
  return sidesFor(kind).find((one) => one.id === side)?.label ?? null;
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
  // Taken once per opening, and deliberately NOT re-taken when the drawing
  // changes. The sheet writes to the document now, and a finish is an entity;
  // recomputing here would let the walk grow a step under the user's thumb
  // between one tap and the next. The backdrop stops anything else editing the
  // plan, so the only changes are this sheet's own — and none of them add a
  // shape to price. The camera can therefore still trust an index into it.
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
  /** which face of each shape is showing, keyed by the step's own id */
  const [openSides, setOpenSides] = useState<OpenSides>({});
  /** the rows whose detail is showing, keyed by `rowKey` */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  /** whether the fullscreen add sheet is up over the wizard */
  const [adding, setAdding] = useState(false);
  /**
   * The material being corrected, or null when nothing is.
   *
   * The material itself and not a row id: what the edit sheet writes is a
   * material, and holding the row would mean re-resolving it on every render
   * of a list that is re-read from the document on every transaction — right
   * as the edit commits and the list changes under it.
   */
  const [editing, setEditing] = useState<Material | null>(null);
  /**
   * Whether the walk has run off its end into the summary.
   *
   * Not derived from `index`, and deliberately: walking to the last shape is
   * not the same as being finished with it, so the summary opens when Next is
   * pressed ON the last step rather than the moment it is reached. Back closes
   * this and leaves the index exactly where it was, so the way out is the way
   * in reversed.
   */
  const [reviewing, setReviewing] = useState(false);

  const step = steps[index];
  const last = index >= steps.length - 1;
  // a wall opens on Side A and a room on its Floor, so the fallback asks the
  // step's own kind rather than assuming a tab id that a room does not have
  const side =
    (step && openSides[step.id]) ?? (step ? defaultSide(step.kind) : 'a');

  /** where this step's build-up can be written, or why it cannot be */
  const target = step ? finishTargetFor(session.doc, step) : null;
  /**
   * The target flattened to a string, so the read effect below turns on a
   * VALUE rather than on an object rebuilt every render.
   *
   * It has to carry the host id and not just the kind: laying a slab under a
   * room turns `room` into `slab`, and if the effect could not see that it
   * would keep showing the empty floor the room had a moment ago.
   */
  const targetKey = target
    ? target.kind === 'wall'
      ? `wall:${target.wallId}`
      : target.kind === 'slab'
        ? `slab:${target.slabId}`
        : target.kind
    : 'none';

  /**
   * What the document says, re-read on every committed transaction.
   *
   * The sheet WRITES now — adding a layer dispatches FINISH.ADD — so what it
   * shows has to follow what it did. Held as a SNAPSHOT rather than derived
   * during render because the document is not a React store: it announces
   * changes on an event, and this is the same subscribe-and-snapshot the rest
   * of the footer uses (see useFooterContext). Nothing here is a second copy
   * of the truth — it is re-read from the document every time, never edited.
   */
  const [view, setView] = useState<DocView>(NOTHING_READ);

  useEffect(() => {
    // resolved INSIDE the effect, against the document as it stands when the
    // event fires: the target captured during render is a step behind by the
    // time a slab has just been laid under this room
    const sync = () =>
      setView(
        readDoc(
          session.doc,
          step,
          step ? finishTargetFor(session.doc, step) : null,
        ),
      );
    sync(); // the step changed, the target changed, or we just mounted
    return session.doc.events.on('change', sync);
  }, [session, step, targetKey]);

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

  /**
   * Bring a layer's strip-out into the drawing, at the extent it is showing.
   *
   * Same surface, same material, `phase: 'demolish'` — that is how core models
   * demolition and it is what puts a `demo-` line in the bill at its own rate.
   * Shared by the switch and by the figures, so a strip-out cannot come into
   * existence two slightly different ways.
   */
  const startDemolition = (
    row: FinishRow,
    at: StepSide,
    next: { width?: number; height?: number } = {},
  ) => {
    const spot = target ? spotsFor(target)[at] : undefined;
    if (!row.cover || !spot || !row.materialId) return;
    const partner = {
      ...row.cover,
      width: row.demolition.width,
      height: row.demolition.height,
    };
    const full = coverPatch(partner, {
      width: next.width ?? partner.width,
      height: next.height ?? partner.height,
    });
    if (spot.kind === 'wall') {
      session.dispatch('FINISH.ADD', {
        wallId: spot.wallId,
        side: spot.side,
        materialId: row.materialId,
        phase: 'demolish',
        t0: partner.t0,
        t1: full['t1'],
        sillHeight: partner.sillHeight,
        topHeight: full['topHeight'],
      });
      return;
    }
    // FLOORFINISH.ADD takes no covered rectangle, so the extent is stated in a
    // second breath — two dispatches, one undo apiece, which is the honest
    // cost of a command that cannot say it in one
    const id = session.dispatch<EntityId>('FLOORFINISH.ADD', {
      slabId: spot.slabId,
      surface: spot.surface,
      materialId: row.materialId,
      phase: 'demolish',
    });
    session.dispatch('FINISH.UPDATE', { id, ...full });
  };

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
            side={side}
            rows={view.rows}
            opened={opened}
            // `undefined` for a wall, the reason for anything else — a finish
            // sits on a wall face, and most of the walk is not one
            blocked={target?.kind === 'none' ? target.reason : undefined}
            onSideChange={(next) =>
              setOpenSides((all) => ({ ...all, [step.id]: next }))
            }
            onToggleDetail={(at, finishId) =>
              setOpened((rows) => {
                const next = new Set(rows);
                const key = rowKey(at, finishId);
                if (!next.delete(key)) next.add(key);
                return next;
              })
            }
            onRemove={(at, finishId) => {
              // the document is the list, so removing a row is erasing the
              // entity — which is undoable, unlike everything this sheet used
              // to do
              session.dispatch('ENTITY.ERASE', { ids: [finishId] });
              // and take its detail row with it, or the set keeps a key for a
              // row that no longer exists
              setOpened((rows) => without(rows, rowKey(at, finishId)));
            }}
            /**
             * Resolved to the MATERIAL here, out of the catalogue the view
             * already read, rather than passed down as a material the row
             * could hold.
             *
             * A row is a finish and a finish is not the thing being edited: it
             * references a material by id, and that material is the drawing's.
             * Resolving at the moment of the tap also means the sheet opens on
             * the material as it stands now, not as it stood when the row was
             * last rendered.
             *
             * A row whose material has gone missing opens nothing. The button
             * is already hidden for a finish with no material at all, so this
             * only catches the material being removed out from under a row
             * between the render and the tap.
             */
            onEditMaterial={(row) =>
              setEditing(
                view.materials.find((one) => one.id === row.materialId) ?? null,
              )
            }
            /**
             * One dispatch per committed field, which is one undo entry per
             * edit — the fields commit on blur rather than per keystroke for
             * exactly that reason.
             *
             * The patch is passed through untouched: `coverPatch` already
             * spoke FINISH.UPDATE's vocabulary, and the command honours only
             * the keys it is given — so what travels is the smallest correct
             * edit, and one that cannot be rejected over a field the user
             * never touched.
             */
            onEdit={(finishId, patch) => {
              session.dispatch('FINISH.UPDATE', { id: finishId, ...patch });
            }}
            onDeduct={(finishId, deductOpenings) => {
              session.dispatch('FINISH.UPDATE', {
                id: finishId,
                deductOpenings,
              });
            }}
            /**
             * The strip-out is a FINISH OF ITS OWN — same surface, same
             * material, `phase: 'demolish'` — because that is how core models
             * demolition, and it is what puts a `demo-` line in the bill at
             * its own rate. It is created the first time a figure is typed
             * rather than the moment a layer is added: a strip-out nobody
             * asked for would price every refurbishment as a demolition.
             *
             * Paired back to its layer by material on the same surface, which
             * is why there is at most one and why the sheet can show it inside
             * the layer instead of as a rival row beside it.
             */
            onDemolish={(finishId, next) => {
              const row = (view.rows[side] ?? []).find(
                (r) => r.id === finishId,
              );
              const spot = target ? spotsFor(target)[side] : undefined;
              if (!row?.cover || !spot || !row.materialId) return;
              // the partner's OWN extent, not the layer's, so typing a width
              // does not silently restate a height taken from the wrong finish
              session.dispatch('FINISH.UPDATE', {
                id: row.demolition.id,
                ...coverPatch(
                  {
                    ...row.cover,
                    width: row.demolition.width,
                    height: row.demolition.height,
                  },
                  next,
                ),
              });
            }}
            /**
             * The switch is what BRINGS the strip-out into existence, and
             * turning it off takes it out again. That is the honest shape of
             * it: a demolish finish either is in the drawing, priced and
             * billed, or it is not — there is no third state where the sheet
             * remembers a figure that the estimate does not carry.
             *
             * On, it starts at the layer's own extent, which is the usual
             * answer: what is being stripped is the face about to be
             * re-covered. Off, the entity is erased, and one undo puts it and
             * its figures back.
             */
            onDemolishToggle={(finishId, on) => {
              const row = (view.rows[side] ?? []).find(
                (r) => r.id === finishId,
              );
              if (!row) return;
              if (!on) {
                if (row.demolition.id !== null) {
                  session.dispatch('ENTITY.ERASE', {
                    ids: [row.demolition.id],
                  });
                }
                return;
              }
              if (row.demolition.id === null) {
                startDemolition(row, side);
              }
            }}
            openings={view.openings[side] ?? []}
            // the door's OWN phase, not the layer's: "does the door go too" is
            // a question about that door, and PHASE.SET already moves openings
            // as well as finishes. The bill then carries it as its own
            // demo-door line rather than folding it into the wall.
            onDemolishOpening={(openingId, demolish) => {
              session.dispatch('PHASE.SET', {
                ids: [openingId],
                phase: demolish ? 'demolish' : 'new',
              });
            }}
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
          {/* Adding a layer is an ACTION on the sheet, so it sits in the row
              the sheet keeps its actions in — beside Close and the camera,
              under the thumb, in the one place that does not move when the
              list under it grows. As a full-width row at the end of the list
              it scrolled away exactly when a long build-up made it hardest to
              reach, and it cost a row of a screen that is half a phone. */}
          {step && target !== null && target.kind !== 'none' && (
            <Button
              isIconOnly
              aria-label="Add layers"
              variant="ghost"
              onPress={() => setAdding(true)}
            >
              <IconPlus />
            </Button>
          )}
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
            {/* Next never disappears now: on the last shape it walks off the
                end into the invoice, which is a step in the same sense the
                shapes are. A button that vanished used to be how the walk
                said "that was the last one" — the invoice says it better, and
                says what was left bare and what it all comes to while it
                does. It is named for where it goes rather than for being over,
                because "Finish" and the Finish entities on every row were the
                same word for two unrelated things. */}
            <Button
              onPress={() => {
                if (last) setReviewing(true);
                else setIndex((at) => Math.min(steps.length - 1, at + 1));
              }}
            >
              {last ? 'Invoice' : 'Next'}
            </Button>
          </div>
        )}
      </Modal.Footer>
      {/* the end of the walk. Read through the document like everything else
          here, so it cannot disagree with the rows the walk just showed. */}
      <ReviewSheet
        steps={reviewSteps(session.doc, steps)}
        isOpen={reviewing}
        onOpenChange={setReviewing}
        onBack={() => setReviewing(false)}
        // Submit closes the whole estimator: the build-up is already in the
        // drawing, written layer by layer as it was entered, so there is
        // nothing here left to save. What this button will eventually do —
        // publish a priced bill — needs rates, which this app has not loaded
        // yet; until then it says the walk is over and means only that.
        onSubmit={() => {
          setReviewing(false);
          close();
        }}
      />
      {step && target !== null && target.kind !== 'none' && (
        // Over the wizard, not beside it: the add sheet is full screen, so
        // while it is up there is no Next to press and the surface it writes
        // onto cannot change under it. Closed, it renders nothing at all.
        <AddLayersSheet
          materials={view.materials}
          sideLabel={sideLabel(step.kind, side)}
          isOpen={adding}
          // what this SURFACE already carries, so the sheet can show it ticked
          // and dead rather than letting the same material be applied twice
          alreadyIn={
            new Set(
              (view.rows[side] ?? [])
                .map((row) => row.materialId)
                .filter((id): id is string => id !== null),
            )
          }
          currency={currentRates().currency}
          onOpenChange={setAdding}
          /**
           * A hand-written layer, written to BOTH sides of the seam.
           *
           * The material goes into the document, where it belongs: a finish
           * references a material id, the drawing saves its own catalogue, and
           * `MATERIAL.ADD` is undoable like every other edit. The PRICE does
           * not — core stores a `costCode` and never a figure, so the rate
           * goes to the app's own table, which is where `priceOf` and the
           * office's published rates already meet.
           *
           * The rate lands FIRST. Adding a material commits a transaction, and
           * that re-reads the whole view; putting the price in beforehand means
           * there is no render in which the new layer exists unpriced.
           *
           * Nothing is dispatched inside a try for decoration: the command
           * validates its own params and throws on a name it will not take,
           * and a throw in a tap handler takes the sheet down with it. Null
           * says "not added" and the catalogue is left as it was.
           */
          onCreate={(layer: ManualLayer) => {
            setManualRate(
              layer.costCode,
              { unit: layer.unit, unitCost: layer.unitCost },
              window.localStorage,
            );
            // the strip-out as its own line at its own rate, which is what
            // `demo-` codes are for: tearing tile off a wall costs a fraction
            // of laying it and has nothing to do with what the tile was worth.
            // Always m², never the layer's own unit — a surface comes off by
            // the area, which is how `boq.ts` measures a demolished finish.
            if (layer.demoCost !== undefined) {
              setManualRate(
                demoCodeFor(layer.costCode),
                { unit: 'm2', unitCost: layer.demoCost },
                window.localStorage,
              );
            }
            try {
              return session.dispatch<MaterialId>('MATERIAL.ADD', {
                name: layer.name,
                unit: layer.unit,
                costCode: layer.costCode,
                ...(layer.coverage !== undefined
                  ? { coverage: layer.coverage }
                  : {}),
              });
            } catch {
              return null;
            }
          }}
          /**
           * One dispatch per material, in catalogue order, because the list is
           * a build-up and its numbers are the order things went on.
           *
           * `spotsToWrite` is the half of the table that may CHANGE the
           * drawing: on a room whose floor has never been laid it lays the slab
           * first, here, at the one moment a new slab is plainly a consequence
           * of what the user just did rather than of what they looked at. It is
           * resolved once for the whole save, so four materials on a bare floor
           * lay one slab and not four.
           *
           * The spot then decides the command, and the type decides the spot:
           * there is no branch here that could send a wall face to
           * FLOORFINISH.ADD, because a wall spot has no slab id to send.
           */
          onSave={(materialIds) => {
            // wrapped, not passed as `session.dispatch`: a bare method
            // reference arrives with no `this` and throws on the command bus
            const spot = spotsToWrite(session.doc, target, (name, params) =>
              session.dispatch(name, params),
            )[side];
            // a room too degenerate to floor: nothing was created trying, and
            // there is nowhere to put a layer
            if (!spot) return;
            for (const materialId of materialIds) {
              if (spot.kind === 'wall') {
                // face to face, not end to end. A wall's baseline runs to the
                // junction POINT, so the default [0, 1] would cover half of
                // every wall it meets — plaster does not, and neither does the
                // dimension drawn over it.
                const wall = session.doc.get(spot.wallId);
                const span =
                  wall instanceof WallEntity
                    ? clearSpan(wall)
                    : { t0: 0, t1: 1 };
                session.dispatch('FINISH.ADD', {
                  wallId: spot.wallId,
                  side: spot.side,
                  materialId,
                  t0: span.t0,
                  t1: span.t1,
                });
              } else {
                session.dispatch('FLOORFINISH.ADD', {
                  slabId: spot.slabId,
                  surface: spot.surface,
                  materialId,
                });
              }
            }
          }}
        />
      )}
      {/* Keyed by the material, so opening a second one REMOUNTS the body and
          re-seeds its draft. Without the key the sheet would reopen still
          holding the last material's name and prices, because the draft is
          deliberately seeded once and never re-synced. */}
      {editing && (
        <LayerSheet
          key={editing.id}
          isOpen
          material={editing}
          currency={currentRates().currency}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          /**
           * The same two writes as adding one, against an existing id.
           *
           * The rate goes in under whatever code the draft ENDED on. Renaming
           * a material can move its cost code, and the price has to follow it
           * or the layer would come back unpriced under its new key — which
           * looks exactly like somebody having deleted the rate.
           *
           * What is deliberately NOT done is deleting the old code's rate. It
           * costs nothing to leave, it is what a drawing already saved against
           * that code still prices by, and a rename is not evidence that
           * nobody quoted the old thing.
           */
          onCommit={(layer: ManualLayer) => {
            setManualRate(
              layer.costCode,
              { unit: layer.unit, unitCost: layer.unitCost },
              window.localStorage,
            );
            if (layer.demoCost !== undefined) {
              setManualRate(
                demoCodeFor(layer.costCode),
                { unit: 'm2', unitCost: layer.demoCost },
                window.localStorage,
              );
            }
            try {
              session.dispatch('MATERIAL.UPDATE', {
                id: editing.id,
                name: layer.name,
                unit: layer.unit,
                costCode: layer.costCode,
                ...(layer.coverage !== undefined
                  ? { coverage: layer.coverage }
                  : {}),
              });
            } catch {
              // the command validates its own params and throws on a name it
              // will not take; a throw here would take the sheet with it
            }
          }}
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

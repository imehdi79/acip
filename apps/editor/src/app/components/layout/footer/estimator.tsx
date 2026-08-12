import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { IconCalculator } from '@tabler/icons-react';
import type { BBox } from '@acip/editor-core';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import type { FitBounds } from '@/editor/ui-state';
import { estimatorSteps } from './estimator-steps';

/**
 * The share of the plan left CLEAR by the sheet at the bottom. A step is one
 * line and a counter, so the sheet lands around 200 px of a ~740 px phone —
 * ~27% — and the rest of this is slack for a long room name, the footer the
 * sheet sits over, and the phone's own bottom inset.
 */
const CLEAR_FRACTION = 0.6;

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

  const step = steps[index];
  const last = index >= steps.length - 1;

  // On the step, and ONLY on the step: opening, Next and Back move the camera,
  // a re-render does not. Anything else and a plan the user had panned or
  // pinched to read would be yanked back under them.
  useEffect(() => {
    if (!step) return;
    const { minX, minY, maxX, maxY } = step.bounds;
    // a shape with no geometry gives the camera nowhere to go; leaving the plan
    // where it is beats sending the viewport to NaN
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
    ui.requestFit(framing(step.bounds));
  }, [ui, step]);

  return (
    <>
      <Modal.Header>
        <Modal.Heading>Estimator</Modal.Heading>
      </Modal.Header>
      {/* one line and a counter: no min-height, because every pixel the sheet
          takes is a pixel of the shape it is naming */}
      <Modal.Body className="flex flex-col justify-center gap-1 text-center">
        {step ? (
          <>
            <p className="text-xs text-muted">
              {index + 1} of {steps.length}
            </p>
            <p className="text-lg font-medium">{step.name}</p>
          </>
        ) : (
          <p className="text-sm text-muted">
            Nothing to price on this level yet.
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="flex justify-between gap-2">
        <Button variant="ghost" onPress={close}>
          Close
        </Button>
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
 */
export function Estimator() {
  return (
    <Modal>
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
          wizard is naming. Transparent leaves the plan legible; the sheet still
          reads as a layer above it from its own surface and shadow. */}
      <Modal.Backdrop variant="transparent">
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

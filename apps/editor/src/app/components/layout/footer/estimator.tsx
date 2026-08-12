import { useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { IconCalculator } from '@tabler/icons-react';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import { estimatorSteps } from './estimator-steps';

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
  // taken once per opening: the plan is behind a backdrop and cannot be edited
  // while the wizard is walking it, so the sequence must not shift underfoot
  const steps = useMemo(
    () => estimatorSteps(session.doc, levelId),
    [session, levelId],
  );
  const [index, setIndex] = useState(0);

  const step = steps[index];
  const last = index >= steps.length - 1;

  return (
    <>
      <Modal.Header>
        <Modal.Heading>Estimator</Modal.Heading>
      </Modal.Header>
      <Modal.Body className="flex min-h-24 flex-col justify-center gap-1 text-center">
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
      <Modal.Backdrop>
        <Modal.Container placement="center">
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

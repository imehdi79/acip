import { Button, Modal } from '@heroui/react';
import { IconCalculator } from '@tabler/icons-react';

/**
 * The estimator: what the drawing costs.
 *
 * A shell for now — the dialog opens empty, deliberately, so the button and
 * its place in the bar can be settled before there is anything to read in it.
 * What goes in comes from the takeoff the model already derives (quantities,
 * rooms, finishes) plus the rate table, so nothing here needs to store or
 * duplicate any of it.
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
              <>
                <Modal.Header>
                  <Modal.Heading>Estimator</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="min-h-24" />
                <Modal.Footer className="flex justify-end">
                  <Button variant="ghost" onPress={close}>
                    Close
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

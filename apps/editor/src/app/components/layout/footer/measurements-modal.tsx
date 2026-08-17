import { useState } from 'react';
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  TextField,
} from '@heroui/react';
import { IconRulerMeasure } from '@tabler/icons-react';
import type { EditorSession } from '@acip/editor-core';
import { unitLabel } from '@/editor/units';
import { useRuntime } from '@/editor/runtime';
import {
  applyMeasurements,
  commonValue,
  prefill,
  selectedWalls,
  wallLength,
  type MeasurementField,
  type MeasureView,
} from './measurements';

/**
 * The form itself, deliberately a child of the dialog rather than of the
 * button: react-aria mounts a modal's contents when it OPENS, so this reads
 * the selection at the moment the user asks to see it.
 *
 * That is what makes the dialog safe to use with multi-select. The footer only
 * re-renders when the KIND of selection changes, so walls gathered one by one
 * behind an already-mounted button would never reach a form whose fields were
 * filled in at mount: it would still be showing the first wall's height, and
 * Apply would then write that height onto every wall gathered since.
 */
function Fields({
  session,
  close,
}: {
  session: EditorSession;
  close: () => void;
}) {
  const { ui } = useRuntime();
  const walls = selectedWalls(session);
  const single = walls.length === 1 ? walls[0] : null;
  // Read once, at the moment the dialog opens, and used for both the prefill
  // and the Apply: the settings sheet cannot be reached from inside this
  // dialog, so the mode cannot change under it — and pinning it means the
  // number Apply subtracts from is the number the field was filled with.
  const view: MeasureView = {
    levelId: ui.activeLevelId.get(),
    mode: ui.measureMode.get(),
  };

  const [length, setLength] = useState(() =>
    prefill(single ? wallLength(session.doc, single, view) : null),
  );
  const [height, setHeight] = useState(() =>
    prefill(commonValue(walls, (wall) => wall.getHeight())),
  );
  const [thickness, setThickness] = useState(() =>
    prefill(commonValue(walls, (wall) => wall.getThickness())),
  );
  const [invalid, setInvalid] = useState<MeasurementField[]>([]);

  const unit = unitLabel();
  const mixed = walls.length > 1 ? 'Mixed' : unit;

  const apply = () => {
    const bad = applyMeasurements(
      session,
      walls,
      { length, height, thickness },
      view,
    );
    setInvalid(bad);
    if (bad.length === 0) close();
  };

  return (
    <>
      <Modal.Header>
        <Modal.Heading>
          {single
            ? 'Wall measurements'
            : `Measurements — ${walls.length} walls`}
        </Modal.Heading>
      </Modal.Header>
      <Modal.Body className="flex flex-col gap-4">
        {single && (
          <TextField
            fullWidth
            value={length}
            onChange={setLength}
            inputMode="decimal"
            isInvalid={invalid.includes('length')}
          >
            <Label>Length ({unit})</Label>
            <Input placeholder={unit} />
            <FieldError>Enter a length greater than zero.</FieldError>
          </TextField>
        )}

        <TextField
          fullWidth
          value={height}
          onChange={setHeight}
          inputMode="decimal"
          isInvalid={invalid.includes('height')}
        >
          <Label>Height ({unit})</Label>
          <Input placeholder={mixed} />
          <FieldError>Enter a height greater than zero.</FieldError>
        </TextField>

        <TextField
          fullWidth
          value={thickness}
          onChange={setThickness}
          inputMode="decimal"
          isInvalid={invalid.includes('thickness')}
        >
          <Label>Thickness ({unit})</Label>
          <Input placeholder={mixed} />
          <FieldError>Enter a thickness greater than zero.</FieldError>
        </TextField>

        {/* the missing Length field is the first thing anyone notices here, so
            it says why rather than leaving the form looking broken */}
        {!single && (
          <p className="text-xs text-muted">
            Height and thickness apply to all {walls.length} walls. Length
            belongs to one wall at a time — select a single wall to change it.
          </p>
        )}

        <p className="text-xs text-muted">
          A typed wall takes its thickness from its assembly, so setting a
          thickness here drops that type.
        </p>
      </Modal.Body>
      <Modal.Footer className="flex justify-end gap-2">
        <Button variant="ghost" onPress={close}>
          Cancel
        </Button>
        <Button onPress={apply}>Apply</Button>
      </Modal.Footer>
    </>
  );
}

/**
 * Wall dimensions as numbers, for a phone: the plan itself has no room for
 * inline editing. Length only appears for a single wall — see
 * applyMeasurements, which owns the whole decision.
 */
export function WallMeasurements({ session }: { session: EditorSession }) {
  return (
    <Modal>
      <Button isIconOnly aria-label="Measurements" variant="tertiary">
        <IconRulerMeasure />
      </Button>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog>
            {({ close }: { close: () => void }) => (
              <Fields session={session} close={close} />
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

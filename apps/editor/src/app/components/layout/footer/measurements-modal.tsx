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
import {
  applyMeasurements,
  commonValue,
  prefill,
  selectedWalls,
  wallLength,
  type MeasurementField,
} from './measurements';

/**
 * Wall dimensions as numbers, for a phone: the plan itself has no room for
 * inline editing. Length only appears for a single wall — see
 * applyMeasurements, which owns the whole decision.
 */
export function WallMeasurements({ session }: { session: EditorSession }) {
  const walls = selectedWalls(session);
  const single = walls.length === 1 ? walls[0] : null;

  const [length, setLength] = useState(() =>
    prefill(single ? wallLength(single) : null),
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

  const apply = (close: () => void) => {
    const bad = applyMeasurements(session, walls, {
      length,
      height,
      thickness,
    });
    setInvalid(bad);
    if (bad.length === 0) close();
  };

  return (
    <Modal>
      <Button isIconOnly aria-label="Measurements" variant="tertiary">
        <IconRulerMeasure />
      </Button>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog>
            {({ close }: { close: () => void }) => (
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
                    <FieldError>
                      Enter a thickness greater than zero.
                    </FieldError>
                  </TextField>

                  <p className="text-xs text-muted">
                    A typed wall takes its thickness from its assembly, so
                    setting a thickness here drops that type.
                  </p>
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2">
                  <Button variant="ghost" onPress={close}>
                    Cancel
                  </Button>
                  <Button onPress={() => apply(close)}>Apply</Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

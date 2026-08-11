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
import { WindowEntity } from '@acip/editor-core';
import { unitLabel } from '@/editor/units';
import { commonValue, prefill } from './measurements';
import {
  applyOpeningMeasurements,
  hasSill,
  selectedOpenings,
  type OpeningField,
} from './opening-measurements';

/**
 * Window and door dimensions as numbers, for a phone. Openings sit inside a
 * wall rather than on the plan's outline, so there is nothing to grab for
 * height or sill — typing them is the only way in.
 */
export function OpeningMeasurements({ session }: { session: EditorSession }) {
  const openings = selectedOpenings(session);
  const single = openings.length === 1 ? openings[0] : null;
  const sill = hasSill(openings);

  const [width, setWidth] = useState(() =>
    prefill(commonValue(openings, (opening) => opening.width)),
  );
  const [height, setHeight] = useState(() =>
    prefill(commonValue(openings, (opening) => opening.height)),
  );
  const [sillHeight, setSillHeight] = useState(() =>
    prefill(sill ? commonValue(openings, (o) => o.getSillHeight()) : null),
  );
  const [thickness, setThickness] = useState(() =>
    prefill(commonValue(openings, (opening) => opening.thickness)),
  );
  const [invalid, setInvalid] = useState<OpeningField[]>([]);

  const unit = unitLabel();
  const mixed = openings.length > 1 ? 'Mixed' : unit;
  const noun = single instanceof WindowEntity ? 'Window' : 'Door';

  const apply = (close: () => void) => {
    const bad = applyOpeningMeasurements(session, openings, {
      width,
      height,
      sill: sillHeight,
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
                      ? `${noun} measurements`
                      : `Measurements — ${openings.length} openings`}
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-4">
                  <TextField
                    fullWidth
                    value={width}
                    onChange={setWidth}
                    inputMode="decimal"
                    isInvalid={invalid.includes('width')}
                  >
                    <Label>Width ({unit})</Label>
                    <Input placeholder={mixed} />
                    <FieldError>Enter a width greater than zero.</FieldError>
                  </TextField>

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

                  {sill && (
                    <TextField
                      fullWidth
                      value={sillHeight}
                      onChange={setSillHeight}
                      inputMode="decimal"
                      isInvalid={invalid.includes('sill')}
                    >
                      <Label>Height from the ground ({unit})</Label>
                      <Input placeholder={mixed} />
                      <FieldError>
                        Enter zero or more — a sill cannot sit below the floor.
                      </FieldError>
                    </TextField>
                  )}

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
                    {sill
                      ? 'Thickness is the frame depth through the wall. Nothing draws it yet — it is kept for the 3D view.'
                      : 'A door opens at floor level, so it has no height from the ground. Thickness is the frame depth through the wall, kept for the 3D view.'}
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

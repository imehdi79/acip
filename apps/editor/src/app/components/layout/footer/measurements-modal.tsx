import { useState } from 'react';
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  Switch,
  TextField,
} from '@heroui/react';
import { IconRulerMeasure } from '@tabler/icons-react';
import type { EditorSession } from '@acip/editor-core';
import { unitLabel } from '@/editor/units';
import { useRuntime } from '@/editor/runtime';
import {
  applyMeasurements,
  commonValue,
  jogPrefill,
  prefill,
  selectedWalls,
  wallLength,
  type JogEdits,
  type JogSide,
  type MeasurementField,
  type MeasureView,
} from './measurements';

/**
 * One corner of the wall: whether it steps, and by how much.
 *
 * A jog is the small sideways offset where two runs of wall meet out of line —
 * one face carries on past the corner while the other steps in. It is stated
 * rather than drawn because it is a decision about the corner, and there is
 * nothing on a phone-sized plan to grab that would say it.
 *
 * The size box only appears once the switch is on. An always-visible box next
 * to an off switch reads as a thing you can fill in, and filling it in would
 * do nothing.
 */
function JogField({
  side,
  label,
  unit,
  value,
  onChange,
  isInvalid,
}: {
  side: JogSide;
  label: string;
  unit: string;
  value: JogEdits[JogSide];
  onChange: (next: JogEdits[JogSide]) => void;
  isInvalid: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Switch
        isSelected={value.on}
        onChange={(on: boolean) => onChange({ ...value, on })}
        className="w-full py-1"
      >
        {/* Switch.Content IS the pressable element; the label rides inside it
            so the words toggle too, which on a phone is most of the target */}
        <Switch.Content className="w-full justify-between gap-2">
          <Label>{label}</Label>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
      {value.on && (
        <TextField
          fullWidth
          value={value.size}
          onChange={(size: string) => onChange({ ...value, size })}
          inputMode="decimal"
          isInvalid={isInvalid}
          aria-label={`${label} step (${unit})`}
        >
          <Input placeholder={`Step (${unit})`} />
          <FieldError>
            Enter a step greater than zero, or turn the corner off.
          </FieldError>
        </TextField>
      )}
    </div>
  );
}

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
  // read at mount like every other field, so the switches show what this wall
  // already does rather than what the last wall did
  const [jogs, setJogs] = useState<JogEdits>(() =>
    single
      ? jogPrefill(single)
      : { start: { on: false, size: '' }, end: { on: false, size: '' } },
  );

  const unit = unitLabel();
  const mixed = walls.length > 1 ? 'Mixed' : unit;

  const apply = () => {
    const bad = applyMeasurements(
      session,
      walls,
      { length, height, thickness },
      view,
      // the same toggle that decides whether a DRAG carries its joins decides
      // whether a resize carries the rooms beyond it: linked pushes them along
      // intact, separate makes them absorb the change and stay put
      ui.detachedMove.get() ? 'absorb' : 'push',
      jogs,
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

        {single && (
          <div className="flex flex-col gap-3 border-t border-separator pt-3">
            <p className="text-xs text-muted">
              Corner steps — where this wall meets the next one out of line.
              Enter a negative step to turn it the other way.
            </p>
            {(['start', 'end'] as const).map((side) => (
              <JogField
                key={side}
                side={side}
                label={side === 'start' ? 'Step at start' : 'Step at end'}
                unit={unit}
                value={jogs[side]}
                onChange={(next) => setJogs({ ...jogs, [side]: next })}
                isInvalid={invalid.includes(
                  side === 'start' ? 'jogStart' : 'jogEnd',
                )}
              />
            ))}
          </div>
        )}

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

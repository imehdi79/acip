import { useId } from 'react';
import { Button, Modal, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useRuntime } from '@/editor/runtime';
import { useStoreValue } from '@/editor/store';
import type { EditorUi, MeasureMode, ResizeReach } from '@/editor/ui-state';

/**
 * The two ways a plan can be dimensioned, in words rather than in faces.
 *
 * "Inside" and "outside" name sides of a wall, which tells someone who has not
 * read docs/editor-core/04-systems/dimensions.md nothing at all — so each one
 * carries the thing it actually measures. Outside is the overall extent, corner
 * to corner across the whole plan; inside is the clear width, the face-to-face
 * span you would run a tape along in a room.
 */
const MEASURE_OPTIONS: readonly { id: MeasureMode; label: string }[] = [
  { id: 'outside', label: 'Outside (overall)' },
  { id: 'inside', label: 'Inside (clear)' },
  // how a surveyed plan is quoted, and the only reading that does not move
  // when a wall is made thicker
  { id: 'center', label: 'Centre' },
];

/**
 * What a typed length does to the rest of the plan.
 *
 * Named for the OUTCOME rather than the mechanism: "connected walls follow" is
 * something you can picture without knowing what a join is, where "linked"
 * alone would not be. The second is deliberately blunt — it says the junction
 * opens, because that is what it does and finding out by accident is worse.
 */
const REACH_OPTIONS: readonly { id: ResizeReach; label: string }[] = [
  { id: 'linked', label: 'Connected walls follow' },
  { id: 'alone', label: 'This wall only' },
];

/**
 * Everything inside the sheet.
 *
 * It takes `ui` rather than reaching for the runtime itself, the way the
 * footer's own toggles do — that is what lets a node test render it at either
 * mode and read the answer back out of the markup, with no provider and no live
 * dialog behind it.
 */
export function SettingsPanel({ ui }: { ui: EditorUi }) {
  const mode = useStoreValue(ui.measureMode);
  const reach = useStoreValue(ui.resizeReach);
  const labelId = useId();
  const reachLabelId = useId();

  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-sm font-medium text-foreground">
        Measurements
      </p>
      {/* Two named buttons, not a switch: a switch has an off position and
          neither of these is off — they are two answers to "measured from
          where?". In single-selection mode the group is a real radiogroup, so
          the one that is on is announced as checked rather than as a button
          somebody happened to leave pressed. Empty is not an answer either, so
          tapping the live one leaves it live.

          Full width and lg: the two options split the sheet, and each half is a
          44 px target. The buttons are direct children on purpose — the group's
          joined shape comes from :first-child/:last-child, so anything wrapping
          one would round it off into a pill of its own. */}
      <ToggleButtonGroup
        fullWidth
        size="lg"
        aria-labelledby={labelId}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[mode]}
        onSelectionChange={(keys) => {
          const picked = MEASURE_OPTIONS.find((option) => keys.has(option.id));
          if (picked) ui.measureMode.set(picked.id);
        }}
      >
        {MEASURE_OPTIONS.map((option) => (
          <ToggleButton id={option.id} key={option.id}>
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <p className="text-xs text-muted">
        Outside dimensions run to the outer wall faces — the overall size of the
        plan. Inside dimensions give each room its clear width, face to face.
      </p>

      <p id={reachLabelId} className="mt-2 text-sm font-medium text-foreground">
        Changing a length
      </p>
      {/* Same shape as the measurement pair above, and for the same reason:
          two answers to one question, neither of them an off position. */}
      <ToggleButtonGroup
        fullWidth
        size="lg"
        aria-labelledby={reachLabelId}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[reach]}
        onSelectionChange={(keys) => {
          const picked = REACH_OPTIONS.find((option) => keys.has(option.id));
          if (picked) ui.resizeReach.set(picked.id);
        }}
      >
        {REACH_OPTIONS.map((option) => (
          <ToggleButton id={option.id} key={option.id}>
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <p className="text-xs text-muted">
        Setting one wall&rsquo;s length normally moves the walls joined to it,
        so a room keeps its corners. Choose &ldquo;this wall only&rdquo; to
        change just the wall you selected — the others stay exactly where they
        are and the corner opens up.
      </p>
    </div>
  );
}

/**
 * Settings, as a sheet.
 *
 * Controlled and trigger-less, because what opens it is a Dropdown.Item: a menu
 * row is a collection entry, not a pressable child a Modal can wrap, so the
 * usual trigger-child form has nothing to attach to. The <Modal> root exists
 * only to own open-ness on a trigger's behalf, so this drops it and drives the
 * overlay directly — react-aria supports exactly that, and keeping the root
 * would leave it holding a press responder with nothing pressable inside, which
 * it complains about in the console.
 *
 * Closed, the overlay renders null, so the panel below is not built until
 * somebody asks for the sheet.
 */
export function SettingsSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { ui } = useRuntime();

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      {/* bottom, like the estimator: a phone's sheets rise from the edge the
          thumb is already at, rather than landing in the middle of the screen */}
      <Modal.Container placement="bottom">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>Settings</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <SettingsPanel ui={ui} />
          </Modal.Body>
          {/* Done rather than Cancel/Save: every control in here takes effect on
              the tap, so there is nothing to commit and nothing to take back */}
          <Modal.Footer className="flex justify-end">
            <Button variant="ghost" onPress={() => onOpenChange(false)}>
              Done
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

import { Button } from '@heroui/react';
import {
  IconAlertTriangle,
  IconAlertTriangleFilled,
} from '@tabler/icons-react';
import type { EditorSession } from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';
import { useStoreValue } from '@/editor/store';
import { toggleDangerZone } from '@/editor/danger-zone';

/**
 * Open and close the danger zone.
 *
 * This is the one footer button that changes what every OTHER tool does — the
 * same wall tool now draws red, onto a layer that disappears when the zone
 * closes, over a plan that has stopped accepting edits. So it does not settle
 * for the quiet pressed look the other toggles use: it turns solid red, the
 * colour the zone itself draws in, and says so in words rather than only in an
 * aria-label. A mode you can be in without noticing is a mode that loses work.
 *
 * `compact` drops the word, not the red. The label is ~110 px of a phone's
 * ~360, and it is spent exactly when the bar is fullest — a selection brings
 * its own run of buttons — so the row would push its own ends off the screen.
 * The colour is what actually carries the mode; the word is the reinforcement,
 * and it is the reinforcement that gives way.
 */
export function DangerZone({
  session,
  ui,
  compact = false,
}: {
  session: EditorSession;
  ui: EditorUi;
  /** no room for the label: the bar is carrying a selection's buttons too */
  compact?: boolean;
}) {
  const on = useStoreValue(ui.dangerZone) !== null;
  const labelled = on && !compact;

  return (
    <Button
      isIconOnly={!labelled}
      aria-label={on ? 'Leave the danger zone' : 'Danger zone'}
      aria-pressed={on}
      variant={on ? 'danger' : 'tertiary'}
      // solid red carries its own foreground; at rest it matches the icons
      // beside it in the session group rather than the muted default
      className={on ? undefined : 'text-foreground'}
      onPress={() => toggleDangerZone(session, ui)}
    >
      {on ? <IconAlertTriangleFilled /> : <IconAlertTriangle />}
      {labelled && 'Danger zone'}
    </Button>
  );
}

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
 */
export function DangerZone({
  session,
  ui,
}: {
  session: EditorSession;
  ui: EditorUi;
}) {
  const on = useStoreValue(ui.dangerZone) !== null;

  return (
    <Button
      isIconOnly={!on}
      aria-label={on ? 'Leave the danger zone' : 'Danger zone'}
      aria-pressed={on}
      variant={on ? 'danger' : 'tertiary'}
      onPress={() => toggleDangerZone(session, ui)}
    >
      {on ? <IconAlertTriangleFilled /> : <IconAlertTriangle />}
      {on && 'Danger zone'}
    </Button>
  );
}

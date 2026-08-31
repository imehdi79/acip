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
 * The word is gone, and the red is not. The label was ~110 px of a phone's
 * ~360, spent exactly when the bar is fullest: opening the zone ADDS this
 * button to a row that already holds the session run, the tools and whatever a
 * selection brought, so the one control that announced the mode was also the
 * one pushing the row's own ends off the screen. It used to give the word up
 * only under a selection, which meant the bar overflowed whenever there was
 * not one.
 *
 * The colour was always what carried the mode — solid red, the colour the zone
 * itself draws in, against a bar of muted icons — and it still does. The icon
 * says it twice, filled rather than outlined. What is lost is the reinforcement
 * for somebody who reads words before colour; `aria-label` still says "Leave
 * the danger zone", so the mode is never unannounced, only unwritten.
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
      isIconOnly
      aria-label={on ? 'Leave the danger zone' : 'Danger zone'}
      aria-pressed={on}
      variant={on ? 'danger' : 'tertiary'}
      // solid red carries its own foreground; at rest it matches the icons
      // beside it in the session group rather than the muted default
      className={on ? undefined : 'text-foreground'}
      onPress={() => toggleDangerZone(session, ui)}
    >
      {on ? <IconAlertTriangleFilled /> : <IconAlertTriangle />}
    </Button>
  );
}

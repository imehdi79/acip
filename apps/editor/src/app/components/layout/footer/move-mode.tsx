import { Button } from '@heroui/react';
import { IconLink, IconUnlink } from '@tabler/icons-react';
import type { EditorUi } from '@/editor/ui-state';
import { useStoreValue } from '@/editor/store';

/**
 * Toggle between dragging a selection WITH its joins and dragging it on its
 * own.
 *
 * Dragging a wall normally carries the walls welded to it — that is what keeps
 * a room a room while it is reshaped. It is also the wrong thing when a plan is
 * being rearranged rather than reshaped: pulling one wall out of a junction
 * drags its neighbours out of shape with it. This is the escape hatch, and it
 * stays on until it is turned off, because rearranging is rarely one drag.
 */
export function MoveMode({ ui }: { ui: EditorUi }) {
  const detached = useStoreValue(ui.detachedMove);

  return (
    <Button
      isIconOnly
      aria-label={detached ? 'Moving separately' : 'Move separately'}
      aria-pressed={detached}
      variant={detached ? 'primary' : 'tertiary'}
      onPress={() => ui.detachedMove.set(!detached)}
    >
      {detached ? <IconUnlink /> : <IconLink />}
    </Button>
  );
}

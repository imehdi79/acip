import { Button } from '@heroui/react';
import { IconSquares, IconSquaresFilled } from '@tabler/icons-react';
import type { EditorUi } from '@/editor/ui-state';
import { useStoreValue } from '@/editor/store';

/**
 * Gather several shapes with several taps.
 *
 * A tap normally replaces the selection, which is right for a phone: one thumb,
 * one thing. But "make these six walls 20 cm thick" needs the six walls in
 * front of the dialog at once, and there is no Shift to hold down. On, a tap
 * adds instead of replacing — and a tap on something already gathered takes it
 * back out, because the alternative to correcting a mis-tap is starting over.
 *
 * It stays on until it is turned off, and turning it off keeps what was
 * gathered: the mode exists to build a selection, so losing the selection when
 * you leave the mode would undo the entire point of it.
 *
 * Filled and primary when on, like the other footer modes — the bar's whole job
 * on a small screen is saying which mode a tap is about to land in.
 */
export function MultiSelect({ ui }: { ui: EditorUi }) {
  const on = useStoreValue(ui.multiSelect);

  return (
    <Button
      isIconOnly
      aria-label={on ? 'Multi-select on' : 'Multi-select'}
      aria-pressed={on}
      variant={on ? 'primary' : 'tertiary'}
      // the pressed variant carries its own foreground; at rest it matches the
      // other icons in the session group rather than the muted default
      className={on ? undefined : 'text-foreground'}
      onPress={() => ui.multiSelect.set(!on)}
    >
      {on ? <IconSquaresFilled /> : <IconSquares />}
    </Button>
  );
}

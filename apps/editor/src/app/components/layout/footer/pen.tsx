import { Button } from '@heroui/react';
import { IconPencil, IconPencilFilled } from '@tabler/icons-react';
import type { EditorUi } from '@/editor/ui-state';
import type { ToolManager } from '@/editor/tools/tool-manager';
import { useStoreValue } from '@/editor/store';

/** the free-draw tool's id, as registered on the runtime */
export const PEN_TOOL = 'sketch';

/**
 * Pick the pen up and put it down.
 *
 * In the session run rather than the tools cluster, because the pen is meant
 * to be there at any moment — the cluster comes and goes with the selection,
 * and a pen you have to clear the selection to reach is a pen you stop using.
 *
 * The same button does both, so the way out is where the way in was. Pressing
 * it while another tool is armed takes that tool's place rather than stacking
 * on it, which is the only sane reading of two tools being asked for at once.
 */
export function Pen({ ui, tools }: { ui: EditorUi; tools: ToolManager }) {
  const on = useStoreValue(ui.activeToolId) === PEN_TOOL;

  return (
    <Button
      isIconOnly
      aria-label={on ? 'Put the pen down' : 'Free draw'}
      aria-pressed={on}
      variant={on ? 'primary' : 'tertiary'}
      // the pressed variant carries its own foreground; at rest it matches the
      // other icons in the session group rather than the muted default
      className={on ? undefined : 'text-foreground'}
      onPress={() => tools.useById(on ? 'select' : PEN_TOOL)}
    >
      {on ? <IconPencilFilled /> : <IconPencil />}
    </Button>
  );
}

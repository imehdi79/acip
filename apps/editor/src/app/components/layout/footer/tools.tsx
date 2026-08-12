import { Button, ButtonGroup, Dropdown, Label } from '@heroui/react';
import { IconDotsVertical } from '@tabler/icons-react';
import type { EditorSession } from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';
import type { ToolManager } from '@/editor/tools/tool-manager';
import { INSERT_ITEMS, insertRoom, type InsertItemType } from './insert';

/**
 * How many tools stand in the bar before the rest fold into a menu. Four icon
 * buttons plus undo/redo is about what a phone can show without the row
 * squeezing; a fifth tool goes behind the dots rather than shrinking the lot.
 */
export const MAX_INLINE_TOOLS = 4;

export interface ToolItem {
  readonly id: InsertItemType;
  readonly label: string;
  readonly icon: React.ReactNode;
}

/**
 * Split the tools into the ones that stand in the bar and the ones that fold
 * away. Everything fits until there is one too many — and then the menu itself
 * takes a slot, so the last inline tool moves into it as well rather than
 * leaving a menu holding a single entry.
 */
export function splitTools(
  items: readonly ToolItem[],
  max = MAX_INLINE_TOOLS,
): { inline: ToolItem[]; folded: ToolItem[] } {
  if (items.length <= max) return { inline: [...items], folded: [] };
  return {
    inline: items.slice(0, max - 1),
    folded: items.slice(max - 1),
  };
}

/** arm a tool, or place a room outright — only the room needs no tool */
export function useTool(
  type: InsertItemType,
  session: EditorSession,
  ui: EditorUi,
  tools: ToolManager,
): void {
  if (type === 'room') insertRoom(session, ui);
  else tools.useById(type);
}

/**
 * The drawing tools, as ONE group at the end of the bar.
 *
 * Arming a tool leaves that tool alone in the group, pressed. The armed tool
 * keeps its own icon and simply reads as held: pressing it again puts it down.
 * One button does the job of two, and the tool in your hand stays the thing
 * under your thumb — which is why it no longer travels anywhere to be put down.
 *
 * The buttons are direct children of the ButtonGroup, which is the only way it
 * joins them into one control — wrap any of them and each renders as its own
 * loose pill.
 */
export function Tools({
  session,
  ui,
  tools,
  activeTool,
  canInsert,
}: {
  session: EditorSession;
  ui: EditorUi;
  tools: ToolManager;
  activeTool: string;
  /** without the permission there is nothing to arm, but a held tool still lets go */
  canInsert: boolean;
}) {
  const armed = activeTool !== 'select';
  const { inline, folded } = splitTools(INSERT_ITEMS);
  // while a tool is held the group shows only that tool; 'room' places
  // outright and is never held, so it never appears here
  const shown = armed
    ? [...inline, ...folded].filter((item) => item.id === activeTool)
    : canInsert
      ? inline
      : [];

  const press = (item: ToolItem) => {
    if (item.id === activeTool) tools.useById('select');
    else useTool(item.id, session, ui, tools);
  };

  const showMenu = folded.length > 0 && !armed && canInsert;
  // Nothing to show: a tool from OUTSIDE this cluster is armed (the pen is one
  // of the modes, at the other end of the bar), or the user may not insert
  // anything. Nothing is the right answer — the cluster stands at the end of
  // the bar now, so there is no slack of its own to hold open.
  if (shown.length === 0 && !showMenu) return null;

  return (
    <ButtonGroup>
      {shown.map((item) => (
        <Button
          key={item.id}
          isIconOnly
          aria-label={item.label}
          aria-pressed={item.id === activeTool}
          variant={item.id === activeTool ? 'primary' : 'tertiary'}
          className="text-foreground"
          onPress={() => press(item)}
        >
          {item.icon}
        </Button>
      ))}
      {showMenu && (
        <Dropdown>
          <Button
            isIconOnly
            aria-label="More tools"
            variant="tertiary"
            className="text-foreground"
          >
            <IconDotsVertical stroke={2} />
          </Button>
          <Dropdown.Popover placement="top end">
            <Dropdown.Menu
              onAction={(key) =>
                useTool(key as InsertItemType, session, ui, tools)
              }
            >
              {folded.map((item) => (
                <Dropdown.Item
                  id={item.id}
                  key={item.id}
                  textValue={item.label}
                >
                  {item.icon}
                  <Label>{item.label}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      )}
    </ButtonGroup>
  );
}

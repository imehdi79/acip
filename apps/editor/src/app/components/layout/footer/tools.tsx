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
 * The drawing tools, as ONE group in the middle of the bar.
 *
 * Arming a tool leaves that tool alone in the group, pressed, and the group
 * travels to the right end of the bar — where Cancel used to sit. The armed
 * tool keeps its own icon and simply reads as held: pressing it again puts it
 * down. One button does the job of two, and the tool in your hand stays the
 * thing under your thumb.
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

  return (
    <div className="flex flex-1 items-center">
      {/* the spacers are what move the group: at rest they share the slack and
          centre it, and when a tool is armed the trailing one gives up its
          share so the group slides to the end. flex-grow animates; a change of
          justify-content does not. */}
      <div className="transition-[flex-grow] duration-300 ease-out grow" />
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
        {folded.length > 0 && !armed && canInsert && (
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
      <div
        className="transition-[flex-grow] duration-300 ease-out"
        style={{ flexGrow: armed ? 0 : 1 }}
      />
    </div>
  );
}

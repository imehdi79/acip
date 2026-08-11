import { Button, ButtonGroup, Dropdown, Label, cn } from '@heroui/react';
import { IconDotsVertical, IconX } from '@tabler/icons-react';
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

/** a tool button that folds itself away when another tool is armed */
function ToolButton({
  item,
  armed,
  onPress,
}: {
  item: ToolItem;
  armed: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      isIconOnly
      aria-label={item.label}
      aria-pressed={armed}
      variant={armed ? 'primary' : 'tertiary'}
      onPress={onPress}
    >
      {/* the armed tool becomes the way to put it down, so it says so */}
      {armed ? <IconX stroke={2} /> : item.icon}
    </Button>
  );
}

/**
 * The drawing tools, as a group in the middle of the bar.
 *
 * Arming one collapses the group to that tool alone, which slides to the right
 * end of the bar — where Cancel used to sit — and turns into the button that
 * puts it down again. That is one button doing the job of two: the tool you
 * are holding is always the thing under your thumb, in the place you already
 * reach for to stop.
 *
 * The buttons are never unmounted, only collapsed, so the slide is a real
 * transition rather than a jump.
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
  /** without the permission the tools are hidden, but a held one can be put down */
  canInsert: boolean;
}) {
  const armed = activeTool !== 'select';
  const { inline, folded } = splitTools(INSERT_ITEMS);

  // 'room' places outright and is never "armed"; anything else can be
  const isArmed = (item: ToolItem) => armed && item.id === activeTool;
  const shown = (item: ToolItem) => (armed ? isArmed(item) : canInsert);

  const press = (item: ToolItem) => {
    if (isArmed(item)) tools.useById('select');
    else useTool(item.id, session, ui, tools);
  };

  return (
    <div className="flex flex-1 items-center">
      {/* the leading spacer keeps the group centred at rest and lets it travel
          to the end once a tool is armed — a flex-grow that can be animated */}
      <div
        className="transition-[flex-grow] duration-300 ease-out"
        style={{ flexGrow: 1 }}
      />
      <ButtonGroup>
        {inline.map((item) => (
          <div
            key={item.id}
            className={cn(
              'overflow-hidden transition-all duration-300 ease-out',
              shown(item) ? 'max-w-16 opacity-100' : 'max-w-0 opacity-0',
            )}
          >
            <ToolButton
              item={item}
              armed={isArmed(item)}
              onPress={() => press(item)}
            />
          </div>
        ))}
        {folded.length > 0 && (
          <div
            className={cn(
              'overflow-hidden transition-all duration-300 ease-out',
              !armed && canInsert
                ? 'max-w-16 opacity-100'
                : 'max-w-0 opacity-0',
            )}
          >
            <Dropdown>
              <Button isIconOnly aria-label="More tools" variant="tertiary">
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
          </div>
        )}
      </ButtonGroup>
      <div
        className="transition-[flex-grow] duration-300 ease-out"
        style={{ flexGrow: armed ? 0 : 1 }}
      />
    </div>
  );
}

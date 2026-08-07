import { Button, Dropdown, Label } from '@heroui/react';
import {
  IconBoxMargin,
  IconPlus,
  IconWall,
  IconWindow,
} from '@tabler/icons-react';
import type { EditorSession, EntityId, Point } from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';

export type InsertItemType = 'room' | 'wall' | 'window';

/** side of the room Insert drops, in metres */
const ROOM_SIZE = 4;
/** gap between the new room and whatever is already drawn */
const ROOM_GAP = 1;

/**
 * Drop a square room clear of the existing drawing, select its walls and frame
 * it. There is no room tool: the select tool's room-resize handles take over
 * from here, so the user drags a corner to size it.
 *
 * One history group, so it is a single undo.
 */
export function insertRoom(session: EditorSession, ui: EditorUi): void {
  const entities = session.doc.all();
  let minX = 0;
  let minY = 0;
  if (entities.length > 0) {
    // to the right of everything drawn so far — never lands on top of it
    let maxX = -Infinity;
    let low = Infinity;
    for (const entity of entities) {
      const b = entity.getBounds();
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < low) low = b.minY;
    }
    minX = maxX + ROOM_GAP;
    minY = low;
  }
  const maxX = minX + ROOM_SIZE;
  const maxY = minY + ROOM_SIZE;
  const corners: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  const levelId = ui.activeLevelId.get();
  const layerId = ui.activeLayerId.get();
  const wallTypes = session.doc.types.list('wall');
  const extra = {
    ...(layerId ? { layerId } : {}),
    ...(levelId ? { levelId } : {}),
    ...(wallTypes.length > 0 ? { typeId: wallTypes[0].id } : {}),
  };

  const ids: EntityId[] = [];
  session.history.beginGroup();
  try {
    for (let i = 0; i < corners.length; i++) {
      ids.push(
        session.dispatch<EntityId>('WALL.ADD', {
          a: corners[i],
          b: corners[(i + 1) % corners.length],
          ...extra,
        }),
      );
    }
  } finally {
    session.history.endGroup();
  }

  session.selection.clear();
  for (const id of ids) session.selection.add(id);
  ui.requestFit({ minX, minY, maxX, maxY });
}

type Item = {
  id: InsertItemType;
  label: string;
  icon: React.ReactNode;
};

const iconClass = 'size-4 shrink-0 text-muted';

const itemsList: Item[] = [
  {
    id: 'room',
    label: 'Room',
    icon: <IconBoxMargin className={iconClass} stroke={2} />,
  },
  {
    id: 'wall',
    label: 'Wall',
    icon: <IconWall className={iconClass} stroke={2} />,
  },
  {
    id: 'window',
    label: 'Window',
    icon: <IconWindow className={iconClass} stroke={2} />,
  },
];

type InsertProps = {
  onInsert?: (type: InsertItemType) => void;
};

// Visibility and permission are decided by the descriptor in actions.tsx.
export function Insert({ onInsert }: InsertProps) {
  return (
    <Dropdown>
      {/* Button is the trigger directly: Dropdown.Trigger is itself a button,
          and nesting one inside another is invalid and double-handles presses. */}
      <Button isIconOnly aria-label="Insert" variant="tertiary">
        <IconPlus stroke={2} />
      </Button>
      <Dropdown.Popover>
        {/* No Section wrapper: it is one unlabelled group, and .menu-item
            already lays out icon + label as a flex row with a gap. */}
        <Dropdown.Menu onAction={(key) => onInsert?.(key as InsertItemType)}>
          {itemsList.map((item) => (
            <Dropdown.Item id={item.id} key={item.id} textValue={item.label}>
              {item.icon}
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

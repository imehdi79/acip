import {
  IconBoxMargin,
  IconDoor,
  IconWall,
  IconWindow,
} from '@tabler/icons-react';
import type { EditorSession, EntityId, Point } from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';
import { withResolvedWalls } from '@/editor/walls';

export type InsertItemType = 'room' | 'wall' | 'window' | 'door';

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
  // one group, one undo — and the room is split against whatever it lands on
  withResolvedWalls(session, () => {
    for (let i = 0; i < corners.length; i++) {
      ids.push(
        session.dispatch<EntityId>('WALL.ADD', {
          a: corners[i],
          b: corners[(i + 1) % corners.length],
          ...extra,
        }),
      );
    }
  });

  session.selection.clear();
  for (const id of ids) session.selection.add(id);
  ui.requestFit({ minX, minY, maxX, maxY });
}

type Item = {
  id: InsertItemType;
  label: string;
  icon: React.ReactNode;
};

/*
 * No colour of its own: these icons are the tool buttons in the bar as well as
 * the rows in the overflow menu, and each place sets its own. Sized between
 * the two — a menu row's 16px looks lost among the bar's 24px neighbours.
 */
const iconClass = 'size-5 shrink-0';

/** what the menu offers, in order — the ids are tool ids bar 'room' */
export const INSERT_ITEMS: Item[] = [
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
  {
    id: 'door',
    label: 'Door',
    icon: <IconDoor className={iconClass} stroke={2} />,
  },
];

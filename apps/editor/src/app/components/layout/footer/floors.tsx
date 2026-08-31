import { Button, Dropdown } from '@heroui/react';
import { IconPlus, IconStack2 } from '@tabler/icons-react';
import type { EditorSession, Level, LevelId } from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';
import { useStoreValue } from '@/editor/store';
import { can, type User } from '@/app/stores/global/settings.store';

/** what a new floor is called when nobody has named it */
export function nextFloorName(levels: readonly Level[]): string {
  return levels.length === 0 ? 'Ground floor' : `Floor ${levels.length}`;
}

/**
 * How high the next floor sits.
 *
 * One storey above the highest one there is, and 3 m is that storey — the same
 * default height `WALL.ADD` gives a wall, so a floor added here lands on top of
 * the walls below it rather than halfway up them.
 *
 * A free function over the list so the arithmetic is checkable without a
 * document, and so "where does the next floor go" is one answer rather than
 * one per caller.
 */
export const STOREY_HEIGHT = 3;

export function nextElevation(levels: readonly Level[]): number {
  if (levels.length === 0) return 0;
  const highest = levels.reduce(
    (top, level) => Math.max(top, level.elevation),
    Number.NEGATIVE_INFINITY,
  );
  return highest + STOREY_HEIGHT;
}

/** what the button says: the live floor, or that every one is showing */
export function floorLabel(
  levels: readonly Level[],
  activeId: LevelId | null,
): string {
  if (activeId === null) return 'All floors';
  return levels.find((level) => level.id === activeId)?.name ?? 'All floors';
}

/**
 * Which floor is being drawn, and the way to add another.
 *
 * The document has always had levels — entities carry one, the walk filters by
 * one, the 3D view builds from one — and nothing in this app ever let anybody
 * pick. A drawing with two storeys in it was reachable only by an agent or the
 * command line.
 *
 * ALL FLOORS is a real choice and the one the editor starts in, not a "none"
 * to be tidied away. A plan drawn before levels existed carries no level at
 * all, and hiding it behind a floor nobody has created yet would make an
 * existing drawing look empty. It is also how you see the whole building at
 * once, which is most of what a second storey is for.
 *
 * A native menu is not used here, unlike the one native control elsewhere in
 * this app: the list is short, it is opened from the footer rather than from a
 * sheet parked over the plan, and it has to carry an action — Add floor — that
 * an OS wheel has nowhere to put.
 */
export function Floors({
  session,
  ui,
  user,
}: {
  session: EditorSession;
  ui: EditorUi;
  /** gates ADDING a floor, not looking at one */
  user: User | null;
}) {
  const activeId = useStoreValue(ui.activeLevelId);
  const levels = session.doc.levels.list();
  // LOOKING at another floor changes nothing in the drawing, so it is offered
  // to everyone the way the modes menu is. Adding one is geometry, and gated
  // with the rest of the geometry.
  const mayAdd = can(user, 'footer.insert');

  const pick = (key: string) => {
    if (key === 'add') {
      const id = session.dispatch<LevelId>('LEVEL.ADD', {
        name: nextFloorName(levels),
        elevation: nextElevation(levels),
      });
      // land on what was just made: adding a floor and staying on the old one
      // is a button that appears to have done nothing
      ui.activeLevelId.set(id);
      return;
    }
    ui.activeLevelId.set(key === 'all' ? null : (key as LevelId));
  };

  return (
    <Dropdown>
      {/* icon only, like every other button in the bar. Which floor is live
          is answered by the menu itself the moment it opens, and by the plan
          behind it — the bar cannot afford a name that grows with it. */}
      <Button
        isIconOnly
        aria-label={`Floors — ${floorLabel(levels, activeId)}`}
        variant="tertiary"
        className="text-foreground"
      >
        <IconStack2 />
      </Button>
      {/* top start, like the modes menu: the footer is at the bottom of a
          phone, so a menu has only one direction to open in */}
      <Dropdown.Popover placement="top start">
        <Dropdown.Menu onAction={(key) => pick(String(key))}>
          <Dropdown.Item id="all">All floors</Dropdown.Item>
          {levels.map((level) => (
            <Dropdown.Item key={level.id} id={level.id}>
              {`${level.name} · ${level.elevation.toFixed(2)} m`}
            </Dropdown.Item>
          ))}
          {mayAdd && (
            <Dropdown.Item id="add">
              <IconPlus size={16} />
              Add floor
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

import type { ReactNode } from 'react';
import type { EditorSession } from '@acip/editor-core';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
  IconRotateClockwise2,
  IconRulerMeasure,
  IconSignature,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import type { EditorUi } from '@/editor/ui-state';
import type { ToolManager } from '@/editor/tools/tool-manager';
import {
  can,
  type Permission,
  type User,
} from '@/app/stores/global/settings.store';
import type { FooterContext } from './context';
import { Insert, insertRoom, type InsertItemType } from './insert';
import { WallMeasurements } from './measurements-modal';
import { OpeningMeasurements } from './opening-measurements-modal';
import { RoomName } from './room-name';
import { MoveMode } from './move-mode';
import { cycleDoorHang } from './door-hang';
import { duplicateSelection } from './duplicate';

/** What a button gets to act on. */
export interface FooterApi {
  readonly session: EditorSession;
  readonly ui: EditorUi;
  readonly tools: ToolManager;
}

export interface FooterItem {
  readonly id: string;
  /** aria-label, and the visible text unless `iconOnly` */
  readonly label: string;
  readonly icon: ReactNode;
  readonly slot: 'start' | 'end';
  /** consecutive visible items sharing a group render as one ButtonGroup */
  readonly group?: string;
  readonly iconOnly?: boolean;
  readonly permission?: Permission;
  /** in the bar at all */
  readonly visible: (ctx: FooterContext) => boolean;
  /** pressable. Omitted = enabled whenever visible. */
  readonly enabled?: (ctx: FooterContext) => boolean;
  readonly run?: (api: FooterApi) => void;
  /** escape hatch for buttons that are not a plain button */
  readonly render?: (api: FooterApi, ctx: FooterContext) => ReactNode;
}

/**
 * The footer, as data. This list is the only thing to edit to add, remove or
 * re-gate a button — the renderer never changes.
 *
 * Array order is render order. The bar is contextual: `visible` reads the
 * selection kind, so each kind of thing gets its own set of buttons.
 */
export const FOOTER_ITEMS: readonly FooterItem[] = [
  {
    id: 'undo',
    label: 'Undo',
    icon: <IconArrowBackUp />,
    slot: 'start',
    group: 'history',
    iconOnly: true,
    permission: 'footer.undo',
    // stays put and greys out, so the bar does not reflow on every edit
    visible: (ctx) => ctx.view === 'editor',
    enabled: (ctx) => ctx.canUndo,
    run: ({ session }) => void session.undo(),
  },
  {
    id: 'redo',
    label: 'Redo',
    icon: <IconArrowForwardUp />,
    slot: 'start',
    group: 'history',
    iconOnly: true,
    permission: 'footer.redo',
    // nothing to redo until you undo, so it appears rather than sits greyed
    visible: (ctx) => ctx.view === 'editor' && ctx.canRedo,
    run: ({ session }) => void session.redo(),
  },
  {
    id: 'measure',
    label: 'Measurements',
    icon: <IconRulerMeasure />,
    slot: 'end',
    group: 'inspect',
    iconOnly: true,
    permission: 'footer.measure',
    // Length, height and thickness are per-wall, so this only makes sense
    // once the selection is walls and nothing else.
    visible: (ctx) => ctx.selection === 'wall',
    render: ({ session }) => <WallMeasurements session={session} />,
  },
  {
    id: 'measure-opening',
    label: 'Measurements',
    icon: <IconRulerMeasure />,
    slot: 'end',
    group: 'inspect',
    iconOnly: true,
    permission: 'footer.measureOpening',
    // An opening measures nothing like its host: width, height, a sill and a
    // frame depth, none of which a wall has. Own gate, own dialog — widening
    // the wall one would mean a form where half the fields never apply.
    visible: (ctx) => ctx.selection === 'window' || ctx.selection === 'door',
    render: ({ session }) => <OpeningMeasurements session={session} />,
  },
  {
    id: 'rename',
    label: 'Room name',
    icon: <IconSignature />,
    slot: 'end',
    group: 'inspect',
    iconOnly: true,
    permission: 'footer.rename',
    visible: (ctx) => ctx.selection === 'room',
    render: ({ session, ui }) => <RoomName session={session} ui={ui} />,
  },
  {
    id: 'door-hang',
    label: 'Change how the door opens',
    icon: <IconRotateClockwise2 />,
    slot: 'end',
    group: 'inspect',
    iconOnly: true,
    permission: 'footer.doorHang',
    visible: (ctx) => ctx.selection === 'door',
    // one press, one visible change: the swing flips, then the hinge moves,
    // and four presses bring the door back where it started
    run: ({ session }) => cycleDoorHang(session),
  },
  {
    id: 'move-mode',
    label: 'Move separately',
    icon: null,
    slot: 'end',
    group: 'inspect',
    iconOnly: true,
    permission: 'footer.moveMode',
    // only walls carry joins, so only a wall or room selection has anything
    // to detach from
    visible: (ctx) => ctx.selection === 'room' || ctx.selection === 'wall',
    render: ({ ui }) => <MoveMode ui={ui} />,
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    icon: <IconCopy className="rotate-180" />,
    slot: 'end',
    group: 'edit',
    iconOnly: true,
    permission: 'footer.duplicate',
    visible: (ctx) => ctx.selection === 'room' || ctx.selection === 'wall',
    run: ({ session, ui }) => duplicateSelection(session, ui),
  },
  {
    id: 'delete',
    label: 'Delete',
    icon: <IconTrash className="text-danger" />,
    slot: 'end',
    group: 'edit',
    iconOnly: true,
    permission: 'footer.delete',
    visible: (ctx) => ctx.count > 0,
    run: ({ session }) => {
      session.dispatch('ENTITY.ERASE', { ids: session.selection.list() });
      // ENTITY.ERASE only touches the document; the selection would otherwise
      // keep holding ids that no longer resolve.
      session.selection.clear();
    },
  },
  {
    id: 'cancel',
    label: 'Cancel',
    icon: <IconX />,
    slot: 'end',
    iconOnly: true,
    // never permission-gated, like the header's Back: no role should be able
    // to arm a tool and then be unable to put it down
    visible: (ctx) => ctx.view === 'editor' && ctx.tool !== 'select',
    // useById deactivates the tool and clears the overlay, so any half-drawn
    // wall and its provisional preview go with it
    run: ({ tools }) => tools.useById('select'),
  },
  {
    id: 'insert',
    label: 'Insert',
    icon: null,
    slot: 'end',
    permission: 'footer.insert',
    // a tool is already armed — Cancel is the action that applies, not another
    // way in
    visible: (ctx) =>
      ctx.view === 'editor' &&
      ctx.selection === 'none' &&
      ctx.tool === 'select',
    render: (api) => (
      <Insert
        onInsert={(type: InsertItemType) => {
          // Wall and window are interactive: arm the tool and let the user
          // drag on the plan. A room needs no tool — it is placed, then handed
          // to the select tool's room-resize handles.
          if (type === 'room') insertRoom(api.session, api.ui);
          else api.tools.useById(type);
        }}
      />
    ),
  },
];

export interface ResolvedFooterItem {
  readonly item: FooterItem;
  readonly enabled: boolean;
}

/**
 * Which buttons the footer shows right now, and which of them are pressable.
 * Pure and React-free on purpose: this is the whole decision, testable from a
 * FooterContext fixture without mounting anything.
 */
export function resolveFooter(
  items: readonly FooterItem[],
  ctx: FooterContext,
  user: User | null,
): ResolvedFooterItem[] {
  return items
    .filter(
      (item) =>
        item.visible(ctx) && (!item.permission || can(user, item.permission)),
    )
    .map((item) => ({ item, enabled: item.enabled?.(ctx) ?? true }));
}

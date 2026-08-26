import type { ReactNode } from 'react';
import type { EditorSession } from '@acip/editor-core';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
  IconRotateClockwise2,
  IconRulerMeasure,
  IconSignature,
  IconStack2,
  IconTrash,
} from '@tabler/icons-react';
import type { EditorUi } from '@/editor/ui-state';
import type { ToolManager } from '@/editor/tools/tool-manager';
import {
  can,
  type Permission,
  type User,
} from '@/app/stores/global/settings.store';
import type { FooterContext } from './context';
import { Tools } from './tools';
import { WallMeasurements } from './measurements-modal';
import { OpeningMeasurements } from './opening-measurements-modal';
import { RoomName } from './room-name';
import { MoveMode } from './move-mode';
import { Modes } from './modes';
import { Floors } from './floors';
import { cycleDoorHang } from './door-hang';
import { duplicateSelection } from './duplicate';

/** What a button gets to act on. */
export interface FooterApi {
  readonly session: EditorSession;
  readonly ui: EditorUi;
  readonly tools: ToolManager;
  /** for a button that gates part of ITSELF rather than all of it */
  readonly user: User | null;
}

export interface FooterItem {
  readonly id: string;
  /** aria-label, and the visible text unless `iconOnly` */
  readonly label: string;
  readonly icon: ReactNode;
  readonly slot: 'start' | 'center' | 'end';
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
  /*
   * The `session` run: the buttons that are about the drawing as a whole
   * rather than about whatever is selected. They are always in the bar, in the
   * same place, so they read as one control at the left — the mirror of the
   * `selection` run at the right, which changes with every tap.
   */
  {
    id: 'undo',
    label: 'Undo',
    icon: <IconArrowBackUp />,
    slot: 'start',
    group: 'session',
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
    group: 'session',
    iconOnly: true,
    permission: 'footer.redo',
    // Always there, greyed when there is nothing to redo. It used to appear
    // only when it had work to do, which kept the bar tidy at the cost of the
    // thing next to it jumping sideways under the thumb on every edit — and
    // undo is what sits next to it.
    visible: (ctx) => ctx.view === 'editor',
    enabled: (ctx) => ctx.canRedo,
    run: ({ session }) => void session.redo(),
  },
  {
    id: 'modes',
    label: 'Modes',
    icon: null,
    slot: 'start',
    group: 'session',
    iconOnly: true,
    /*
     * The modes menu, and whichever mode is live right now.
     *
     * Ungated as a descriptor, like the tools cluster: what it OFFERS is gated
     * item by item inside, and a menu that vanished entirely would take the way
     * OUT of a mode with it.
     *
     * Its subject is the next tap rather than the current selection, so it sits
     * in the session run with undo/redo — the half of the bar that does not
     * reflow. In the selection run it would slide sideways under the thumb
     * every time a tap changed which buttons that run holds.
     */
    visible: (ctx) => ctx.view === 'editor',
    render: (api, ctx) => <Modes {...api} compact={ctx.count > 0} />,
  },
  {
    id: 'floors',
    label: 'Floors',
    icon: <IconStack2 />,
    slot: 'start',
    group: 'session',
    // the drawing as a whole, so it sits with undo and the modes rather than
    // with the buttons that come and go with a selection
    visible: (ctx) => ctx.view === 'editor',
    render: ({ session, ui, user }, ctx) => (
      <Floors session={session} ui={ui} user={user} compact={ctx.count > 0} />
    ),
  },
  {
    id: 'measure',
    label: 'Measurements',
    icon: <IconRulerMeasure />,
    slot: 'end',
    group: 'selection',
    iconOnly: true,
    permission: 'footer.measure',
    // Length, height and thickness are per-wall, so this only makes sense once
    // the selection is walls and nothing else. A room is exactly that — the
    // classifier only calls a selection a room when every entity in it is a
    // wall — and "give this room's walls one thickness" is the commonest
    // multi-wall edit there is, so it would be perverse to hide the dialog for
    // the one selection shaped like the job.
    visible: (ctx) => ctx.selection === 'wall' || ctx.selection === 'room',
    render: ({ session }) => <WallMeasurements session={session} />,
  },
  {
    id: 'measure-opening',
    label: 'Measurements',
    icon: <IconRulerMeasure />,
    slot: 'end',
    group: 'selection',
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
    group: 'selection',
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
    group: 'selection',
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
    group: 'selection',
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
    group: 'selection',
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
    group: 'selection',
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
    id: 'tools',
    label: 'Tools',
    icon: null,
    slot: 'end',
    /*
     * Deliberately ungated, unlike every other editing button: the cluster
     * carries the armed tool AND the way to put it down, and arming a tool
     * must never be a one-way door. What it OFFERS is gated inside, on the
     * same footer.insert permission the old Insert menu used.
     *
     * At the END of the bar, with the buttons that act on a selection: both are
     * about the drawing in front of you, while the left is about the session
     * around it. It no longer travels from the middle either — the cluster
     * simply stands where the selection run stands, which is where the thumb
     * already is.
     */
    visible: (ctx) =>
      ctx.view === 'editor' &&
      (ctx.selection === 'none' || ctx.tool !== 'select'),
    render: ({ session, ui, tools, user }, ctx) => (
      <Tools
        session={session}
        ui={ui}
        tools={tools}
        activeTool={ctx.tool}
        canInsert={can(user, 'footer.insert')}
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

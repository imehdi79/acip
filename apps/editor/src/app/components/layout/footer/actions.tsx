import type { ReactNode } from 'react';
import type { EditorSession } from '@acip/editor-core';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCalculator,
  IconCopy,
  IconListCheck,
  IconPencil,
  IconRotateClockwise2,
  IconRulerMeasure,
  IconSignature,
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
import { MultiSelect } from './multi-select';
import { Pen } from './pen';
import { DangerZone } from './danger-zone';
import { Estimator } from './estimator';
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
    // nothing to redo until you undo, so it appears rather than sits greyed
    visible: (ctx) => ctx.view === 'editor' && ctx.canRedo,
    run: ({ session }) => void session.redo(),
  },
  {
    id: 'danger-zone',
    label: 'Danger zone',
    icon: <IconAlertTriangle />,
    slot: 'start',
    group: 'session',
    iconOnly: true,
    permission: 'footer.dangerZone',
    /*
     * The one editing button with no selection in its gate: it decides what
     * happens to the NEXT thing drawn, so it has to be reachable before there
     * is anything to select — and, once on, reachable from wherever the user
     * ends up, or the mode becomes a trap.
     *
     * In the session run, well away from the contextual buttons at the end, so
     * it never reads as another thing to do to the selection.
     */
    visible: (ctx) => ctx.view === 'editor',
    render: ({ session, ui }, ctx) => (
      <DangerZone session={session} ui={ui} compact={ctx.count > 0} />
    ),
  },
  {
    id: 'estimator',
    label: 'Estimator',
    icon: <IconCalculator />,
    slot: 'start',
    group: 'session',
    iconOnly: true,
    permission: 'footer.estimator',
    // what the whole drawing costs — no selection in the gate, because the
    // estimate is of the plan, not of whatever happens to be tapped
    visible: (ctx) => ctx.view === 'editor',
    render: () => <Estimator />,
  },
  {
    id: 'multi-select',
    label: 'Multi-select',
    icon: <IconListCheck />,
    slot: 'start',
    group: 'session',
    iconOnly: true,
    permission: 'footer.multiSelect',
    /*
     * The second button whose subject is the NEXT tap rather than the current
     * selection, so it is gated like the danger zone and not like the run at
     * the end: a toggle that waited for something to be selected could never
     * start a multi-selection, and one that vanished once the selection was
     * complete would strand the user in a mode with no way out.
     *
     * Last in the session run, nearest the middle — it belongs beside the
     * things it is a mode for, and the session run is the half of the bar that
     * does not reflow. In the selection run it would slide sideways under the
     * thumb every time a tap changed which buttons that run holds, and the tap
     * that follows a gathered tap is the one you least want landing on Delete.
     */
    visible: (ctx) => ctx.view === 'editor',
    render: ({ ui }) => <MultiSelect ui={ui} />,
  },
  {
    id: 'pen',
    label: 'Free draw',
    icon: <IconPencil />,
    slot: 'start',
    group: 'session',
    iconOnly: true,
    permission: 'footer.freeDraw',
    // In the session run and never gated on the selection: the pen is meant to
    // be there at any moment, and the tools cluster it would otherwise live in
    // comes and goes with what is selected.
    visible: (ctx) => ctx.view === 'editor',
    render: ({ ui, tools }) => <Pen ui={ui} tools={tools} />,
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
    slot: 'center',
    /*
     * Deliberately ungated, unlike every other editing button: the cluster
     * carries the armed tool AND the way to put it down, and arming a tool
     * must never be a one-way door. What it OFFERS is gated inside, on the
     * same footer.insert permission the old Insert menu used.
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

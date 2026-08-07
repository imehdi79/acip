import type { ReactNode } from 'react';
import type { EditorSession } from '@acip/editor-core';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
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
import { Insert, insertRoom, type InsertItemType } from './insert';

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
 * Array order is render order.
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
    id: 'duplicate',
    label: 'Duplicate',
    icon: <IconCopy className="rotate-180" />,
    slot: 'end',
    group: 'edit',
    permission: 'footer.duplicate',
    visible: (ctx) => ctx.selection === 'room',
    // editor-core has no ENTITY.DUPLICATE command yet — ENTITY.ERASE has no
    // counterpart, and LEVEL.DUPLICATE is levels only. Enable once it exists.
    enabled: () => false,
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
    id: 'insert',
    label: 'Insert',
    icon: null,
    slot: 'end',
    permission: 'footer.insert',
    visible: (ctx) => ctx.view === 'editor' && ctx.selection === 'none',
    render: (api) => (
      <Insert
        onInsert={(type: InsertItemType) => {
          // Wall and window are interactive: arm the tool and let the user
          // tap on the plan. A room needs no tool — it is placed, then handed
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

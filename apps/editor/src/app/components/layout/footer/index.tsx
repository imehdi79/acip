import { Fragment } from 'react';
import { Button, ButtonGroup } from '@heroui/react';
import { useSettingsStore } from '@/app/stores/global/settings.store';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import { useFooterContext, type FooterContext } from './context';
import {
  FOOTER_ITEMS,
  resolveFooter,
  type FooterApi,
  type ResolvedFooterItem,
} from './actions';

/** Consecutive items sharing a group render inside one ButtonGroup. */
function chunk(items: ResolvedFooterItem[]): ResolvedFooterItem[][] {
  const runs: ResolvedFooterItem[][] = [];
  for (const entry of items) {
    const last = runs.at(-1);
    const group = entry.item.group;
    if (last && group && last[0].item.group === group) last.push(entry);
    else runs.push([entry]);
  }
  return runs;
}

function FooterButton({
  entry,
  api,
  ctx,
}: {
  entry: ResolvedFooterItem;
  api: FooterApi;
  ctx: FooterContext;
}) {
  const { item, enabled } = entry;
  if (item.render) return <>{item.render(api, ctx)}</>;
  return (
    <Button
      isIconOnly={item.iconOnly}
      isDisabled={!enabled}
      aria-label={item.label}
      variant="tertiary"
      onPress={() => item.run?.(api)}
    >
      {item.icon}
      {!item.iconOnly && item.label}
    </Button>
  );
}

function Slot({
  items,
  api,
  ctx,
}: {
  items: ResolvedFooterItem[];
  api: FooterApi;
  ctx: FooterContext;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center">
      {chunk(items).map((run) => {
        const body = run.map((entry) => (
          <FooterButton key={entry.item.id} entry={entry} api={api} ctx={ctx} />
        ));
        return run.length > 1 ? (
          <ButtonGroup key={run[0].item.id}>{body}</ButtonGroup>
        ) : (
          <Fragment key={run[0].item.id}>{body}</Fragment>
        );
      })}
    </div>
  );
}

/**
 * Renders whatever FOOTER_ITEMS resolves to. Nothing here knows what any
 * button does — add or re-gate buttons in actions.tsx.
 */
const Footer = () => {
  const session = useSession();
  const { ui, tools } = useRuntime();
  const user = useSettingsStore((state) => state.user);
  const ctx = useFooterContext();

  const api: FooterApi = { session, ui, tools };
  const resolved = resolveFooter(FOOTER_ITEMS, ctx, user);
  const start = resolved.filter((entry) => entry.item.slot === 'start');
  const end = resolved.filter((entry) => entry.item.slot === 'end');

  return (
    <div className="absolute bottom-0 h-14 w-full flex items-center justify-between px-4">
      <Slot items={start} api={api} ctx={ctx} />
      {/* ml-auto keeps the end slot right when the start slot is empty */}
      <div className="ml-auto">
        <Slot items={end} api={api} ctx={ctx} />
      </div>
    </div>
  );
};

export default Footer;

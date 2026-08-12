import { Fragment } from 'react';
import { Button, ButtonGroup, cn } from '@heroui/react';
import { useSettingsStore } from '@/app/stores/global/settings.store';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import { useFooterContext, type FooterContext } from './context';
import {
  FOOTER_ITEMS,
  resolveFooter,
  type FooterApi,
  type FooterItem,
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
  // returned bare, not wrapped: ButtonGroup marks its DIRECT children, and a
  // Fragment in the way both swallows that marker and takes a prop React does
  // not allow it to have
  if (item.render) return item.render(api, ctx);
  return (
    <Button
      isIconOnly={item.iconOnly}
      isDisabled={!enabled}
      aria-label={item.label}
      variant="tertiary"
      // the muted default is hard to pick out against a plan on a phone in
      // daylight; the bar's icons carry the whole meaning, so they read solid
      className="text-foreground"
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
  grow,
}: {
  items: ResolvedFooterItem[];
  api: FooterApi;
  ctx: FooterContext;
  /** takes the leftover width, so its contents can move within it */
  grow?: boolean;
}) {
  // an empty centre must still hold the slack open, or the end slot slides
  if (items.length === 0) return grow ? <div className="flex-1" /> : null;
  return (
    <div className={cn('flex items-center', grow && 'flex-1')}>
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

  const api: FooterApi = { session, ui, tools, user };
  const resolved = resolveFooter(FOOTER_ITEMS, ctx, user);
  const inSlot = (slot: FooterItem['slot']) =>
    resolved.filter((entry) => entry.item.slot === slot);

  return (
    <div className="absolute bottom-0 h-14 w-full flex items-center gap-2 px-4">
      <Slot items={inSlot('start')} api={api} ctx={ctx} />
      {/* the centre takes the slack, so the tools sit between the two ends and
          have somewhere to travel when one of them is armed */}
      <Slot items={inSlot('center')} api={api} ctx={ctx} grow />
      <Slot items={inSlot('end')} api={api} ctx={ctx} />
    </div>
  );
};

export default Footer;

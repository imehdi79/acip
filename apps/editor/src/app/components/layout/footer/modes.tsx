import { useState, type ReactNode } from 'react';
import { Button, Dropdown, Label } from '@heroui/react';
import {
  IconAlertTriangle,
  IconCalculator,
  IconDotsVertical,
  IconListCheck,
  IconPencil,
} from '@tabler/icons-react';
import { useStoreValue } from '@/editor/store';
import { enterDangerZone } from '@/editor/danger-zone';
import { can, type Permission } from '@/app/stores/global/settings.store';
import type { FooterApi } from './actions';
import { DangerZone } from './danger-zone';
import { Estimator } from './estimator';
import { MultiSelect } from './multi-select';
import { Pen, PEN_TOOL } from './pen';

/** what the menu offers, in the order it offers it */
export interface ModeItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly permission: Permission;
}

/**
 * The menu, as data — so "who may use which mode" is testable without a DOM,
 * the way the footer's own descriptors are. Every entry carries a permission:
 * folding a button into a menu must not be a way of losing its gate.
 */
export const MODE_ITEMS: readonly ModeItem[] = [
  {
    id: PEN_TOOL,
    label: 'Free draw',
    icon: <IconPencil className="size-5 shrink-0" />,
    permission: 'footer.freeDraw',
  },
  {
    id: 'multi-select',
    label: 'Multi-select',
    icon: <IconListCheck className="size-5 shrink-0" />,
    permission: 'footer.multiSelect',
  },
  {
    id: 'danger-zone',
    label: 'Danger zone',
    icon: <IconAlertTriangle className="size-5 shrink-0" />,
    permission: 'footer.dangerZone',
  },
  {
    id: 'estimator',
    label: 'Estimator',
    icon: <IconCalculator className="size-5 shrink-0" />,
    permission: 'footer.estimator',
  },
];

/**
 * The modes, behind one menu — and out in the bar the moment one is live.
 *
 * Four buttons that are each rarely wanted crowd out the two that are always
 * wanted, on a bar with about six slots. So they fold into a menu, and a mode
 * that is ON puts its own button back beside undo/redo, where it reads as what
 * it is: a toggle, pressed, one tap from being put down. A mode you can be in
 * without seeing is a mode that surprises you later — which is why the button
 * comes back rather than the menu merely remembering.
 *
 * Nothing here holds "which mode is selected". Three of the four already know:
 * the pen is the armed tool, the danger zone is its layer, multi-select is its
 * flag. Asking them is one source of truth instead of two that can disagree.
 * The estimator is the exception — a dialog has no lasting state to ask about —
 * so its open-ness is the one thing this component keeps.
 */
export function Modes({
  session,
  ui,
  tools,
  user,
  compact,
}: FooterApi & {
  /** the bar is carrying a selection's buttons too — no room for a word */
  compact?: boolean;
}) {
  // the estimator is a dialog, not a mode: it is "live" exactly while open, and
  // picking it from the menu opens it rather than arming anything
  const [estimating, setEstimating] = useState(false);
  const zone = useStoreValue(ui.dangerZone) !== null;
  const multi = useStoreValue(ui.multiSelect);
  const pen = useStoreValue(ui.activeToolId) === PEN_TOOL;

  const allowed = MODE_ITEMS.filter((item) => can(user, item.permission));

  // Picking from the menu turns a mode ON; it is the surfaced button that turns
  // it off again. The danger zone goes through its own function rather than
  // having its flag set from here — entering it locks layers and opens a
  // history group, which is a document edit, not a piece of UI state.
  const pick = (id: string) => {
    if (id === PEN_TOOL) tools.useById(PEN_TOOL);
    else if (id === 'multi-select') ui.multiSelect.set(true);
    else if (id === 'danger-zone') enterDangerZone(session, ui);
    else if (id === 'estimator') setEstimating(true);
  };

  return (
    <>
      {/* every live mode stands in the bar, not just one: they are independent
          toggles, and a mode with no way back to it is a trap */}
      {pen && <Pen ui={ui} tools={tools} />}
      {multi && <MultiSelect ui={ui} />}
      {zone && <DangerZone session={session} ui={ui} compact={compact} />}
      {estimating && (
        <Estimator defaultOpen onOpenChange={(open) => setEstimating(open)} />
      )}
      {allowed.length > 0 && (
        <Dropdown>
          <Button
            isIconOnly
            aria-label="Modes"
            variant="tertiary"
            className="text-foreground"
          >
            <IconDotsVertical stroke={2} />
          </Button>
          <Dropdown.Popover placement="top start">
            <Dropdown.Menu onAction={(key) => pick(String(key))}>
              {allowed.map((item) => (
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
      )}
    </>
  );
}

import { useState, type ReactNode } from 'react';
import { Button, Dropdown, Label } from '@heroui/react';
import {
  IconDeviceFloppy,
  IconDotsVertical,
  IconFilePlus,
  IconFolderOpen,
  IconSettings,
} from '@tabler/icons-react';
import { SettingsSheet } from './settings';
import { ProjectsSheet } from './projects-sheet';

type MoreItemId = 'create-new' | 'save' | 'open' | 'settings';

type MoreItem = {
  id: MoreItemId;
  label: string;
  icon: ReactNode;
};

const iconClass = 'size-4 shrink-0 text-muted';

/**
 * The menu, as data — so who is offered what is testable without a DOM, the way
 * the footer's own menu is (MODE_ITEMS in footer/modes.tsx). It is a list rather
 * than inline conditionals for a second reason as well: a `false` child inside a
 * Dropdown.Menu collection is not a valid item.
 */
export const moreItems = (canOpenSettings: boolean): readonly MoreItem[] => [
  {
    id: 'create-new',
    label: 'Create New',
    icon: <IconFilePlus className={iconClass} stroke={2} />,
  },
  /*
   * Save and Open sit next to Create New because all three are the same
   * question — which drawing am I in — and a guest gets them for the same
   * reason a guest gets Create New: a plan somebody spent an afternoon on
   * should not depend on their role to survive the tab closing.
   */
  {
    id: 'save',
    label: 'Save plan',
    icon: <IconDeviceFloppy className={iconClass} stroke={2} />,
  },
  {
    id: 'open',
    label: 'Open plan',
    icon: <IconFolderOpen className={iconClass} stroke={2} />,
  },
  ...(canOpenSettings
    ? [
        {
          id: 'settings' as const,
          label: 'Settings',
          icon: <IconSettings className={iconClass} stroke={2} />,
        },
      ]
    : []),
];

type HeaderMoreProps = {
  canOpenSettings: boolean;
  onCreateNew: () => void;
};

/**
 * The header's only menu. It replaces the editor's Back button, so Create New
 * is deliberately ungated: it is how any role — guests included — leaves a
 * plan, and no role should be stuck in the editor.
 */
const HeaderMore = ({ canOpenSettings, onCreateNew }: HeaderMoreProps) => {
  // The one thing the menu has to remember: a dialog has no lasting state of its
  // own to ask about, the same way the footer's estimator does not.
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** null = shut; otherwise which half of the projects sheet opened */
  const [projects, setProjects] = useState<'save' | 'open' | null>(null);
  const items = moreItems(canOpenSettings);

  return (
    <>
      <Dropdown>
        <Button isIconOnly aria-label="Menu" variant="tertiary">
          <IconDotsVertical stroke={2} />
        </Button>
        <Dropdown.Popover placement="bottom start">
          <Dropdown.Menu
            onAction={(key) => {
              if (key === 'create-new') onCreateNew();
              else if (key === 'save') setProjects('save');
              else if (key === 'open') setProjects('open');
              else if (key === 'settings') setSettingsOpen(true);
            }}
          >
            {items.map((item) => (
              <Dropdown.Item id={item.id} key={item.id} textValue={item.label}>
                {item.icon}
                <Label>{item.label}</Label>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {/* Beside the Dropdown, never inside it: picking the item closes the
          popover, and a dialog mounted within it would be torn down in the same
          breath as the menu that asked for it. Gated with the item rather than
          on its own — the sheet has exactly one way in, and this is it.

          It adds no box to the header row: closed it renders nothing, open it
          renders into a portal, so the bar stays the menu and the profile. */}
      {canOpenSettings && (
        <SettingsSheet isOpen={settingsOpen} onOpenChange={setSettingsOpen} />
      )}
      {/* beside the Dropdown for the same reason the settings sheet is */}
      <ProjectsSheet
        mode={projects}
        onOpenChange={(open) => !open && setProjects(null)}
      />
    </>
  );
};

export default HeaderMore;

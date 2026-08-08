import type { ReactNode } from 'react';
import { Button, Dropdown, Label } from '@heroui/react';
import {
  IconDotsVertical,
  IconFilePlus,
  IconSettings,
} from '@tabler/icons-react';

type MoreItemId = 'create-new' | 'settings';

type MoreItem = {
  id: MoreItemId;
  label: string;
  icon: ReactNode;
};

const iconClass = 'size-4 shrink-0 text-muted';

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
  // Built as a list rather than inline conditionals: a `false` child inside a
  // Dropdown.Menu collection is not a valid item.
  const items: MoreItem[] = [
    {
      id: 'create-new',
      label: 'Create New',
      icon: <IconFilePlus className={iconClass} stroke={2} />,
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

  return (
    <Dropdown>
      <Button isIconOnly aria-label="Menu" variant="tertiary">
        <IconDotsVertical stroke={2} />
      </Button>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu
          onAction={(key) => {
            if (key === 'create-new') onCreateNew();
            // no settings screen yet
            else console.log(`Selected: ${key}`);
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
  );
};

export default HeaderMore;

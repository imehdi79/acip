import { Button, Dropdown, Label } from '@heroui/react';
import {
  IconBoxMargin,
  IconPlus,
  IconWall,
  IconWindow,
} from '@tabler/icons-react';
import { useFooterAction } from '@/app/stores/global/settings.store';

export type InsertItemType = 'room' | 'wall' | 'window';

type Item = {
  id: InsertItemType;
  label: string;
  icon: React.ReactNode;
};

const iconClass = 'size-4 shrink-0 text-muted';

const itemsList: Item[] = [
  {
    id: 'room',
    label: 'Room',
    icon: <IconBoxMargin className={iconClass} stroke={2} />,
  },
  {
    id: 'wall',
    label: 'Wall',
    icon: <IconWall className={iconClass} stroke={2} />,
  },
  {
    id: 'window',
    label: 'Window',
    icon: <IconWindow className={iconClass} stroke={2} />,
  },
];

type InsertProps = {
  onInsert?: (type: InsertItemType) => void;
};

export function Insert({ onInsert }: InsertProps) {
  const canInsert = useFooterAction('insert');

  if (!canInsert) return null;

  return (
    <Dropdown>
      {/* Button is the trigger directly: Dropdown.Trigger is itself a button,
          and nesting one inside another is invalid and double-handles presses. */}
      <Button isIconOnly aria-label="Insert" variant="tertiary">
        <IconPlus stroke={2} />
      </Button>
      <Dropdown.Popover>
        {/* No Section wrapper: it is one unlabelled group, and .menu-item
            already lays out icon + label as a flex row with a gap. */}
        <Dropdown.Menu onAction={(key) => onInsert?.(key as InsertItemType)}>
          {itemsList.map((item) => (
            <Dropdown.Item id={item.id} key={item.id} textValue={item.label}>
              {item.icon}
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

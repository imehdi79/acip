'use client';

import { Button, Dropdown, Label } from '@heroui/react';
import {
  IconBoxMargin,
  IconPlus,
  IconWall,
  IconWindow,
} from '@tabler/icons-react';

export type InsertItemType = 'room' | 'wall' | 'window';

type Item = {
  id: InsertItemType;
  label: string;
  icon: React.ReactNode;
};

const itemsList: Item[] = [
  {
    id: 'room',
    label: 'Room',
    icon: <IconBoxMargin stroke={2} />,
  },
  {
    id: 'wall',
    label: 'Wall',
    icon: <IconWall stroke={2} />,
  },
  {
    id: 'window',
    label: 'Window',
    icon: <IconWindow stroke={2} />,
  },
];

type InsertProps = {
  onInsert?: (type: InsertItemType) => void;
};

export function Insert({ onInsert }: InsertProps) {
  return (
    <Dropdown>
      <Dropdown.Trigger>
        <Button isIconOnly aria-label="Insert" variant="outline">
          <IconPlus stroke={2} />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu onAction={(key) => onInsert?.(key as InsertItemType)}>
          <Dropdown.Section>
            {itemsList.map((item) => (
              <Dropdown.Item id={item.id} key={item.id} textValue={item.label}>
                <div className="flex h-8 items-start justify-center pt-px">
                  <span className="size-4 shrink-0 text-muted">
                    {item.icon}
                  </span>
                </div>
                <div className="flex flex-col">
                  <Label>{item.label}</Label>
                </div>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

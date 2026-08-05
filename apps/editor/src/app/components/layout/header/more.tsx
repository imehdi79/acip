import { Button, Dropdown, Label } from '@heroui/react';
import { IconDotsVertical, IconSettings } from '@tabler/icons-react';

const HeaderMore = () => {
  return (
    <Dropdown>
      <Button isIconOnly aria-label="Menu" variant="tertiary">
        <IconDotsVertical stroke={2} />
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu onAction={(key) => console.log(`Selected: ${key}`)}>
          <Dropdown.Item id="settings" textValue="Settings">
            <IconSettings className="size-4 shrink-0 text-muted" stroke={2} />
            <Label>Settings</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
};

export default HeaderMore;

import { Button, Dropdown } from '@heroui/react';
import {
  IconDotsVertical,
  IconSettings,
  IconUserCircle,
} from '@tabler/icons-react';

const Header = () => {
  return (
    <div className="absolute top-0 z-10 flex w-full items-center justify-between py-2 px-4">
      <Dropdown>
        <Dropdown.Trigger>
          <Button isIconOnly aria-label="More" variant="outline">
            <IconDotsVertical stroke={2} />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu onAction={(key) => console.log(`Selected: ${key}`)}>
            <Dropdown.Item id="settings" textValue="Settings">
              <IconSettings className="size-4 shrink-0 text-muted" stroke={2} />
              Settings
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <Button isIconOnly aria-label="Profile" variant="outline">
        <IconUserCircle stroke={2} />
      </Button>
    </div>
  );
};

export default Header;

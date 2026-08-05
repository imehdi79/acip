import { User } from '@/app/stores/global/settings.store';
import { Dropdown, Button, Label } from '@heroui/react';
import { IconUserCircle, IconLogin, IconLogout } from '@tabler/icons-react';

const HeaderProfile = ({
  user,
  signOut,
  isGuest,
}: {
  user: User | null;
  signOut: () => void;
  isGuest: boolean;
}) => {
  return (
    <Dropdown>
      <Button
        isIconOnly
        aria-label="Profile"
        variant="tertiary"
        className="ml-auto"
      >
        <IconUserCircle stroke={2} />
      </Button>
      <Dropdown.Popover placement="bottom end" className="min-w-56">
        {/* Account block sits outside the Menu: it is not selectable. */}
        <div className="px-3 pb-1 pt-3">
          <p className="truncate text-sm font-medium text-foreground">
            {user?.name ?? 'Guest'}
          </p>
          <p className="text-xs capitalize text-muted">
            {user?.role ?? 'guest'}
          </p>
        </div>
        <Dropdown.Menu
          onAction={(key) => {
            if (key === 'sign-out') signOut();
          }}
        >
          <Dropdown.Item
            id="sign-out"
            textValue={isGuest ? 'Sign in' : 'Sign out'}
          >
            {isGuest ? (
              <IconLogin className="size-4 shrink-0 text-muted" stroke={2} />
            ) : (
              <IconLogout className="size-4 shrink-0 text-muted" stroke={2} />
            )}
            <Label>{isGuest ? 'Sign in' : 'Sign out'}</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
};

export default HeaderProfile;

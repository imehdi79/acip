import { Button } from '@heroui/react';
import { IconArrowLeft } from '@tabler/icons-react';
import { useCan, useSettingsStore } from '@/app/stores/global/settings.store';
import HeaderMore from './more';
import HeaderProfile from './profile';

const Header = () => {
  const canOpenSettings = useCan('header.settings');
  const canOpenProfile = useCan('header.profile');
  const user = useSettingsStore((state) => state.user);
  const signOut = useSettingsStore((state) => state.signOut);
  const view = useSettingsStore((state) => state.view);
  const setView = useSettingsStore((state) => state.setView);

  // Guests are signed in as a guest-role user, so both cases clear the user and
  // land back on the sign-in view — only the wording differs.
  const isGuest = user?.role === 'guest';

  return (
    <div className="absolute top-0 z-10 h-14 flex w-full items-center justify-between px-4">
      {/* Back is never permission-gated: no role should be stuck in the editor. */}
      {view === 'editor' ? (
        <Button
          isIconOnly
          aria-label="Back to projects"
          variant="tertiary"
          onPress={() => setView('projects')}
        >
          <IconArrowLeft stroke={2} />
        </Button>
      ) : (
        canOpenSettings && <HeaderMore />
      )}

      {/* ml-auto keeps profile on the right even when the menu is hidden */}
      {canOpenProfile && (
        <HeaderProfile isGuest={isGuest} signOut={signOut} user={user} />
      )}
    </div>
  );
};

export default Header;

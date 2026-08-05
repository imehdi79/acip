import { useCan, useSettingsStore } from '@/app/stores/global/settings.store';
import HeaderMore from './more';
import HeaderProfile from './profile';

const Header = () => {
  const canOpenSettings = useCan('header.settings');
  const canOpenProfile = useCan('header.profile');
  const user = useSettingsStore((state) => state.user);
  const signOut = useSettingsStore((state) => state.signOut);

  // Guests are signed in as a guest-role user, so both cases clear the user and
  // land back on the sign-in view — only the wording differs.
  const isGuest = user?.role === 'guest';

  return (
    <div className="absolute top-0 z-10 h-14 flex w-full items-center justify-between px-4">
      {canOpenSettings && <HeaderMore />}

      {/* ml-auto keeps profile on the right even when the menu is hidden */}
      {canOpenProfile && (
        <HeaderProfile isGuest={isGuest} signOut={signOut} user={user} />
      )}
    </div>
  );
};

export default Header;

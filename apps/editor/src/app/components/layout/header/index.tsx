import { useCan, useSettingsStore } from '@/app/stores/global/settings.store';
import HeaderMore from './more';
import HeaderProfile from './profile';

const Header = () => {
  const canOpenSettings = useCan('header.settings');
  const canOpenProfile = useCan('header.profile');
  const user = useSettingsStore((state) => state.user);
  const signOut = useSettingsStore((state) => state.signOut);
  const setView = useSettingsStore((state) => state.setView);

  // Guests are signed in as a guest-role user, so both cases clear the user and
  // land back on the sign-in view — only the wording differs.
  const isGuest = user?.role === 'guest';

  return (
    // min-h rather than h, so the safe-area padding ADDS to the bar instead of
    // eating into it: on a notched iPhone the row still gets its full 56 px of
    // touch target, sitting below the notch rather than under it.
    <div className="absolute top-0 z-10 flex min-h-14 w-full items-center justify-between px-4 pt-[env(safe-area-inset-top)]">
      {/* The menu is the same on both views and never fully gated — it carries
          Create New, which took over from Back as the way out of the editor. */}
      <HeaderMore
        canOpenSettings={canOpenSettings}
        onCreateNew={() => setView('projects')}
      />

      {/* ml-auto keeps profile on the right even when the menu is hidden */}
      {canOpenProfile && (
        <HeaderProfile isGuest={isGuest} signOut={signOut} user={user} />
      )}
    </div>
  );
};

export default Header;

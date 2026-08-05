import { create } from 'zustand';

/** Everything a user is allowed to do maps to a real button in the UI. */
export type Permission =
  | 'footer.undo'
  | 'footer.duplicate'
  | 'footer.delete'
  | 'footer.insert'
  | 'header.settings'
  | 'header.profile';

export type Role = 'guest' | 'viewer' | 'editor' | 'admin';

export type User = {
  id: string;
  name: string;
  role: Role;
};

/** Signed-out users are treated as `guest`. */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  guest: ['header.profile'],
  viewer: ['header.profile', 'header.settings'],
  editor: [
    'header.profile',
    'header.settings',
    'footer.undo',
    'footer.duplicate',
    'footer.delete',
    'footer.insert',
  ],
  admin: [
    'header.profile',
    'header.settings',
    'footer.undo',
    'footer.duplicate',
    'footer.delete',
    'footer.insert',
  ],
};

type SettingsState = {
  // app config
  showHeader: boolean;
  showFooter: boolean;
  setShowHeader: (show: boolean) => void;
  setShowFooter: (show: boolean) => void;
  toggleHeader: () => void;
  toggleFooter: () => void;

  // access control
  user: User | null;
  signIn: (user: User) => void;
  signOut: () => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  showHeader: true,
  showFooter: false,
  setShowHeader: (showHeader) => set({ showHeader }),
  setShowFooter: (showFooter) => set({ showFooter }),
  toggleHeader: () => set((state) => ({ showHeader: !state.showHeader })),
  toggleFooter: () => set((state) => ({ showFooter: !state.showFooter })),

  user: null,
  signIn: (user) => set({ user }),
  signOut: () => set({ user: null }),
}));

/** Can this user do `permission`? `null` (signed out) resolves as `guest`. */
export const can = (user: User | null, permission: Permission): boolean =>
  ROLE_PERMISSIONS[user?.role ?? 'guest'].includes(permission);

/** `const canDelete = useCan('footer.delete');` */
export const useCan = (permission: Permission): boolean =>
  useSettingsStore((state) => can(state.user, permission));

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlanTemplateId } from '@/editor/templates';

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Chrome per view                                                             */
/* -------------------------------------------------------------------------- */

/** Which screen the user is on. Tracked so a reload puts them back. */
export type AppView = 'projects' | 'editor';

/** Footer buttons, in the order the footer lays them out. */
export type FooterAction = 'undo' | 'duplicate' | 'delete' | 'insert';

export type Chrome = {
  header: boolean;
  footer: boolean;
  /** Which footer buttons this view offers at all. */
  footerActions: FooterAction[];
};

/**
 * Chrome is a property of the view, not something callers toggle by hand: the
 * project list has no footer, the editor does. Add a view here and its chrome
 * comes with it.
 */
const VIEW_CHROME: Record<AppView, Chrome> = {
  projects: {
    header: true,
    footer: false,
    footerActions: [],
  },
  editor: {
    header: true,
    footer: true,
    footerActions: ['undo', 'duplicate', 'delete', 'insert'],
  },
};

type SettingsState = {
  // access control
  user: User | null;
  signIn: (user: User) => void;
  signOut: () => void;

  // where they were
  view: AppView;
  setView: (view: AppView) => void;

  /** Starter plan the editor generates on open. */
  template: PlanTemplateId | null;
  /** Pick a plan and go straight to the editor. */
  openTemplate: (template: PlanTemplateId) => void;

  /** Per-view patches layered over VIEW_CHROME — for runtime changes. */
  chrome: Partial<Record<AppView, Partial<Chrome>>>;
  setChrome: (view: AppView, patch: Partial<Chrome>) => void;
  resetChrome: (view: AppView) => void;
};

/** Exactly what goes to localStorage — actions are rebuilt on every load. */
type PersistedSettings = {
  user: User | null;
  view: AppView;
  template: PlanTemplateId | null;
  chrome: Partial<Record<AppView, Partial<Chrome>>>;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      user: null,
      signIn: (user) => set({ user }),
      // Signing out also drops the view, so the next person in does not land
      // in a project they never opened.
      signOut: () => set({ user: null, view: 'projects' }),

      view: 'projects',
      setView: (view) => set({ view }),

      template: null,
      openTemplate: (template) => set({ template, view: 'editor' }),

      chrome: {},
      setChrome: (view, patch) =>
        set((state) => ({
          chrome: {
            ...state.chrome,
            [view]: { ...state.chrome[view], ...patch },
          },
        })),
      resetChrome: (view) =>
        set((state) => {
          const { [view]: _dropped, ...rest } = state.chrome;
          return { chrome: rest };
        }),
    }),
    {
      name: 'acip-editor-settings',
      version: 2,
      partialize: (state): PersistedSettings => ({
        user: state.user,
        view: state.view,
        template: state.template,
        chrome: state.chrome,
      }),
      migrate: (persisted, version): PersistedSettings => {
        const { user, view, template, chrome } = (persisted ??
          {}) as Partial<PersistedSettings>;

        return {
          user: user ?? null,
          view: view ?? 'projects',
          template: template ?? null,
          // v1 stored showHeader/showFooter flags; chrome comes from the view
          // now, so drop them rather than let stale flags win.
          chrome: version >= 2 ? (chrome ?? {}) : {},
        };
      },
    },
  ),
);

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

/** Defaults for the view, with any runtime patch applied on top. */
const chromeFor = (state: SettingsState, view: AppView): Chrome => ({
  ...VIEW_CHROME[view],
  ...state.chrome[view],
});

/** Can this user do `permission`? `null` (signed out) resolves as `guest`. */
export const can = (user: User | null, permission: Permission): boolean =>
  ROLE_PERMISSIONS[user?.role ?? 'guest'].includes(permission);

/** `const canDelete = useCan('footer.delete');` */
export const useCan = (permission: Permission): boolean =>
  useSettingsStore((state) => can(state.user, permission));

// Selectors below return primitives on purpose: a selector building a fresh
// object or array every call would re-render on every store write.

export const useShowHeader = (): boolean =>
  useSettingsStore((state) => chromeFor(state, state.view).header);

export const useShowFooter = (): boolean =>
  useSettingsStore((state) => chromeFor(state, state.view).footer);

/** A footer button shows when the view offers it and the user may use it. */
export const useFooterAction = (action: FooterAction): boolean =>
  useSettingsStore(
    (state) =>
      chromeFor(state, state.view).footerActions.includes(action) &&
      can(state.user, `footer.${action}`),
  );

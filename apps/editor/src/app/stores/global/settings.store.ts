import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlanTemplateId } from '@/editor/templates';

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

/** Everything a user is allowed to do maps to a real button in the UI. */
export type Permission =
  | 'footer.undo'
  | 'footer.redo'
  | 'footer.duplicate'
  | 'footer.delete'
  | 'footer.insert'
  | 'footer.measure'
  | 'footer.curveWall'
  | 'footer.measureOpening'
  | 'footer.rename'
  | 'footer.moveMode'
  | 'footer.multiSelect'
  | 'footer.freeDraw'
  | 'footer.doorHang'
  | 'footer.dangerZone'
  | 'footer.estimator'
  | 'header.settings'
  | 'header.profile';

export type Role = 'guest' | 'viewer' | 'editor' | 'admin';

export type User = {
  id: string;
  name: string;
  role: Role;
};

/** Everything that changes the drawing — editors and admins hold all of it. */
const EDITING_PERMISSIONS: Permission[] = [
  'header.profile',
  'header.settings',
  'footer.undo',
  'footer.redo',
  'footer.duplicate',
  'footer.delete',
  'footer.insert',
  'footer.measure',
  'footer.curveWall',
  'footer.measureOpening',
  'footer.rename',
  'footer.moveMode',
  // gathering a selection changes nothing on its own, but everything it is
  // gathered FOR does — it travels with the editing set rather than ahead of it
  'footer.multiSelect',
  // the pen draws walls, so it is exactly as privileged as the wall tool
  'footer.freeDraw',
  'footer.doorHang',
  'footer.dangerZone',
  // reading a cost off the plan changes nothing, so this could widen to
  // viewers later; it starts with the editing set because what it will show is
  // money, and that is a decision to make deliberately rather than by default
  'footer.estimator',
];

/** Signed-out users are treated as `guest`. */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  guest: ['header.profile'],
  viewer: ['header.profile', 'header.settings'],
  editor: EDITING_PERMISSIONS,
  admin: EDITING_PERMISSIONS,
};

/* -------------------------------------------------------------------------- */
/* Chrome per view                                                             */
/* -------------------------------------------------------------------------- */

/** Which screen the user is on. Tracked so a reload puts them back. */
export type AppView = 'projects' | 'editor';

export type Chrome = {
  header: boolean;
  footer: boolean;
};

/**
 * Chrome is a property of the view, not something callers toggle by hand: the
 * project list has no footer, the editor does. Add a view here and its chrome
 * comes with it.
 *
 * Which buttons the footer shows is not decided here — a footer descriptor
 * gates itself on the live context (see footer/actions.tsx).
 */
const VIEW_CHROME: Record<AppView, Chrome> = {
  projects: {
    header: true,
    footer: false,
  },
  editor: {
    header: true,
    footer: true,
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
      version: 3,
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
          // v1 stored showHeader/showFooter flags and v2 a footerActions
          // allow-list; both are decided elsewhere now, so drop the whole patch
          // rather than let a stale shape win.
          chrome: version >= 3 ? (chrome ?? {}) : {},
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

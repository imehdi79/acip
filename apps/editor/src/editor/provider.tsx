import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  EditorSession,
  loadDocumentInto,
  saveDocument,
} from '@acip/editor-core';
import { useSettingsStore } from '@/app/stores/global/settings.store';
import {
  DRAFT_DEBOUNCE_MS,
  clearDraft,
  openProjectStore,
  readDraft,
  writeDraft,
} from '@/data/draft';
import { SessionContext } from './session-context';
import { RuntimeContext, createRuntime } from './runtime';
import { generatePlan, type PlanTemplateId } from './templates';

/**
 * Owns the session and runtime for the whole signed-in shell, not just the
 * viewport: the footer sits outside <EditorView> and still needs to read
 * selection and history. Both are plain object graphs — no canvas, no DOM — so
 * building them at sign-in rather than at editor open costs nothing.
 */
export function EditorProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new EditorSession());
  const [runtime] = useState(() => createRuntime(session));
  const template = useSettingsStore((state) => state.template);
  const view = useSettingsStore((state) => state.view);
  const generatedFor = useRef<PlanTemplateId | null>(null);
  /**
   * Whether the draft has had its one chance to be restored.
   *
   * One chance, and only on the first run after a mount. Picking a starter
   * plan from the selector must still GENERATE one — that is an explicit "new
   * drawing", and restoring a draft over it would make the selector do
   * nothing. So the draft outranks the template exactly once, when the editor
   * comes up on its own, which is what a reload is.
   */
  const restored = useRef(false);

  // generatePlan calls newDocument(), which wipes the drawing. The session now
  // outlives the editor view, so without this guard every trip back from the
  // projects list would erase the user's work. Generate once per pick.
  useEffect(() => {
    if (!template || view !== 'editor') return;
    if (generatedFor.current === template) return;
    generatedFor.current = template;

    // A plan opened from the selector's Recent list is ALREADY the document,
    // loaded deliberately a moment before the view changed. Neither branch
    // below should run over it: not the draft (a write that failed its quota
    // would restore a stale one), and not the template.
    //
    // This state cannot be reached any other way. A reload starts with a fresh
    // session — empty document, and `openProjectStore` back to null — and
    // picking a starter plan clears the store before it navigates, which is
    // what keeps the selector's two routes out of each other's way.
    if (openProjectStore.get() !== null && session.doc.all().length > 0) return;

    // A reload used to land here and regenerate the template over whatever was
    // on screen — the settings store remembers the pick, the fresh session
    // remembers nothing, and an afternoon's work went to an empty room. The
    // draft is what the user was actually looking at, so it wins.
    if (!restored.current) {
      restored.current = true;
      const draft = readDraft(window.localStorage);
      if (draft) {
        try {
          // `newDocument` FIRST, for the reason the projects sheet gives:
          // loadDocumentInto ADDS, and `levels.add` throws on an id it has
          // already seen. The document is usually empty here — but not when a
          // plan was opened from the selector a moment ago, and restoring the
          // draft on top of it would throw into the catch below and generate
          // the template over the plan the user just picked.
          session.newDocument();
          loadDocumentInto(session.doc, draft.document, session.entityTypes);
          openProjectStore.set(draft.projectId);
          runtime.tools.useById('select');
          runtime.ui.requestFit();
          return;
        } catch {
          // A draft core will not load is a draft from an older format, or a
          // half-written one. Falling through to the template beats an editor
          // that will not open at all — and the draft is overwritten by the
          // first edit after that, so it cannot keep failing.
        }
      }
    }

    // an explicit new plan: the old draft describes a drawing nobody is
    // looking at any more
    clearDraft(window.localStorage);
    openProjectStore.set(null);
    generatePlan(session, template);
    // Free draw hands over a blank sheet, and the first thing anybody does
    // with one is move it to where they want to start. So the editor lands on
    // the tool that PANS rather than one that would take that first drag as a
    // wall — the drawing tools are a tap away in the bar, and an accidental
    // line is not.
    runtime.tools.useById('select');
    // The viewport subscribes in a child effect, which has already run.
    runtime.ui.requestFit();
  }, [session, runtime, template, view]);

  /**
   * Keep the draft current, on the document's own change event.
   *
   * Debounced rather than written per change: the event is one per committed
   * transaction, so this is not smoothing a firehose, but a burst — four
   * layers applied in one Save — would otherwise serialise the document four
   * times for one user action.
   *
   * `pagehide` is what makes the debounce safe. It fires when the tab is
   * actually going away, including the back/forward cache and a phone
   * discarding a background tab, which `beforeunload` is unreliable for on
   * mobile. Without it the last 400 ms of work is exactly what a close loses.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;

    const flush = () => {
      if (!dirty) return;
      dirty = false;
      clearTimeout(timer);
      writeDraft(window.localStorage, {
        savedAt: Date.now(),
        document: saveDocument(session.doc),
        projectId: openProjectStore.get(),
      });
    };

    const off = session.doc.events.on('change', () => {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(flush, DRAFT_DEBOUNCE_MS);
    });
    window.addEventListener('pagehide', flush);

    return () => {
      clearTimeout(timer);
      off();
      window.removeEventListener('pagehide', flush);
    };
  }, [session]);

  return (
    <SessionContext.Provider value={session}>
      <RuntimeContext.Provider value={runtime}>
        {children}
      </RuntimeContext.Provider>
    </SessionContext.Provider>
  );
}

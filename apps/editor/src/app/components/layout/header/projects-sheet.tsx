import { useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { IconTrash } from '@tabler/icons-react';
import { loadDocumentInto, saveDocument } from '@acip/editor-core';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import {
  MAX_PROJECTS,
  deleteProject,
  listProjects,
  openProject,
  savedAgo,
  saveProject,
  type ProjectSummary,
} from '@/data/projects';
import { clearDraft, openProjectStore, writeDraft } from '@/data/draft';
import { applyProjectRates, snapshotRates } from '@/data/rates';
import {
  applyProjectLayerDefaults,
  snapshotLayerDefaults,
} from '@/data/layer-defaults';
import { codeOf } from '@/app/components/layout/footer/estimator-add-layers';

/**
 * Saving and opening a plan, in one sheet with two faces.
 *
 * One component because the two are one list seen from either side: saving
 * shows what the new plan will sit beside and which one it would push out;
 * opening shows the same rows with a different verb on them. Two sheets would
 * have meant two copies of the list, the ordering and the empty state.
 *
 * The list is read on OPENING rather than watched. `localStorage` announces
 * nothing when it changes, and the only thing writing to it is this sheet, so
 * a subscription would be a subscription to itself.
 */
export function ProjectsSheet({
  mode,
  onOpenChange,
}: {
  /** which face is showing, or null when the sheet is shut */
  mode: 'save' | 'open' | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal.Backdrop isOpen={mode !== null} onOpenChange={onOpenChange}>
      <Modal.Container placement="bottom">
        <Modal.Dialog>
          {mode !== null && (
            <ProjectsBody mode={mode} close={() => onOpenChange(false)} />
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/**
 * Split out so it MOUNTS with the sheet: the list and the name are read once
 * per opening, and a sheet reopened after a save has to show the save.
 */
function ProjectsBody({
  mode,
  close,
}: {
  mode: 'save' | 'open';
  close: () => void;
}) {
  const session = useSession();
  const { ui } = useRuntime();
  const [saved, setSaved] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState('');
  /** what went wrong with the last Save, or null while nothing has */
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const list = listProjects(window.localStorage);
    setSaved(list);
    // The plan you have OPEN, not the one saved most recently. Prefilling from
    // the top of the list is how saving a plan opened an hour ago used to
    // overwrite a different one and leave the original stale.
    const open = openProjectStore.get();
    setName(list.find((p) => p.id === open)?.name ?? 'My plan');
  }, []);

  const doSave = () => {
    // only the codes this drawing uses — see snapshotRates
    const codes = session.doc.materials.list().map(codeOf);
    const withDemo = [...codes, ...codes.map((c) => `demo-${c}`)];
    const outcome = saveProject(window.localStorage, {
      id: openProjectStore.get(),
      name,
      document: saveDocument(session.doc),
      rates: snapshotRates(withDemo),
      defaults: snapshotLayerDefaults(codes),
    });
    setSaved(
      outcome.projects.map(({ id, name: n, savedAt }) => ({
        id,
        name: n,
        savedAt,
      })),
    );
    if (!outcome.ok) {
      // The sheet STAYS OPEN. It used to close either way, so a save that
      // could not happen looked exactly like one that did — and the drawing it
      // failed to keep was still only in memory.
      setFailed(outcome.reason);
      return;
    }
    // this drawing now belongs to that slot, and the draft has to agree or a
    // reload would hand it back unattached
    openProjectStore.set(outcome.saved.id);
    writeDraft(window.localStorage, {
      savedAt: outcome.saved.savedAt,
      document: outcome.saved.document,
      projectId: outcome.saved.id,
    });
    close();
  };

  const doOpen = (id: string) => {
    const project = openProject(window.localStorage, id);
    if (!project) return;
    // `newDocument` FIRST: loadDocumentInto ADDS to whatever is already there,
    // so loading over a live plan would merge the two — and `levels.add`
    // throws on an id it has already seen, which is a save that opens once and
    // then refuses. Same session throughout, because a new one would orphan
    // every subscription the viewport and footer already hold.
    session.newDocument();
    loadDocumentInto(session.doc, project.document, session.entityTypes);
    // the prices it was quoted at, over this device's own table. A plan saved
    // before prices travelled carries none, and gets the device table alone —
    // which is exactly what it was priced against at the time.
    applyProjectRates(project.rates ?? {}, window.localStorage);
    applyProjectLayerDefaults(project.defaults ?? {}, window.localStorage);
    openProjectStore.set(project.id);
    writeDraft(window.localStorage, {
      savedAt: Date.now(),
      document: project.document,
      projectId: project.id,
    });
    session.selection.clear();
    ui.requestFit();
    close();
  };

  return (
    <>
      <Modal.Header>
        <p className="text-xs text-muted">
          {saved.length} of {MAX_PROJECTS} saved on this device
        </p>
        <Modal.Heading>
          {mode === 'save' ? 'Save plan' : 'Open plan'}
        </Modal.Heading>
      </Modal.Header>
      <Modal.Body className="text-left">
        {mode === 'save' && (
          <label className="flex flex-col gap-1 pb-2 text-sm">
            <span className="text-muted">Name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                // a failure is about the save that was attempted, not about
                // the sheet — typing a different name is a new attempt
                setFailed(null);
              }}
              className="w-full rounded-sm border border-separator bg-surface px-2 py-2"
            />
          </label>
        )}
        {/* Said where the Save button is, and the sheet stays open behind it.
            The drawing is still only in memory at this point, so the one thing
            that must not happen is the user walking away believing it is
            not. */}
        {failed !== null && (
          <p role="alert" className="pb-2 text-sm text-danger">
            {failed}
          </p>
        )}
        {saved.length === 0 ? (
          <p className="text-sm text-muted">
            {mode === 'save'
              ? 'Nothing saved yet — this will be the first.'
              : 'Nothing saved on this device yet.'}
          </p>
        ) : (
          <ul className="text-sm">
            {saved.map((project, at) => (
              <li
                key={project.id}
                className="flex items-center gap-2 border-b border-separator last:border-0"
              >
                <button
                  type="button"
                  // saving does not open: the row is there to be read, not
                  // pressed, so only the Open face makes it a target
                  disabled={mode === 'save'}
                  onClick={() => doOpen(project.id)}
                  className="min-w-0 flex-1 py-2.5 text-left disabled:opacity-70"
                >
                  <span className="block truncate">{project.name}</span>
                  <span className="block text-xs text-muted">
                    {savedAgo(project.savedAt)}
                    {/* the one that goes when a sixth is saved, said before it
                        goes rather than after */}
                    {mode === 'save' &&
                      saved.length === MAX_PROJECTS &&
                      at === saved.length - 1 &&
                      ' · will be replaced'}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${project.name}`}
                  onClick={() => {
                    setSaved(
                      deleteProject(window.localStorage, project.id).map(
                        ({ id, name: n, savedAt }) => ({
                          id,
                          name: n,
                          savedAt,
                        }),
                      ),
                    );
                    // the drawing stays on screen; it just has no slot any
                    // more, so the next Save writes a new one rather than
                    // resurrecting the row that was just deleted
                    if (openProjectStore.get() === project.id) {
                      openProjectStore.set(null);
                      clearDraft(window.localStorage);
                    }
                  }}
                  className="grid size-11 shrink-0 place-items-center text-muted"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal.Body>
      <Modal.Footer className="flex justify-end gap-2">
        <Button variant="ghost" onPress={close}>
          Close
        </Button>
        {mode === 'save' && <Button onPress={doSave}>Save</Button>}
      </Modal.Footer>
    </>
  );
}

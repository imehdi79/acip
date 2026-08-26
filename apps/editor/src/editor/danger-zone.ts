import type {
  DrawingDocument,
  EditorSession,
  Layer,
  LayerId,
} from '@acip/editor-core';
import type { EditorUi } from './ui-state';

/**
 * Danger zone: a mode for drawing changes to a plan that is not yours to
 * change. While it is on, everything new lands on one layer, draws red, and the
 * plan underneath is locked — visible, snappable, but untouchable. While it is
 * off that work is hidden outright, so the original plan reads exactly as it
 * did before anyone opened the zone.
 *
 * There is no parallel system here: a layer already carries a colour, a
 * visibility flag and a lock, and the read paths already honour all three
 * (render, snap, pick). The mode is nothing but those flags, flipped together.
 *
 * The zone lives in the DOCUMENT (a layer, through LAYER.* commands like every
 * other mutation), so the work survives save/open. Which layers were locked to
 * protect it does not need remembering: the zone is the only thing in this
 * editor that locks one, so leaving unlocks the rest outright.
 */

/**
 * The layer's name is its identity — a reopened document has to be recognised
 * as holding a zone, and an id in localStorage would not survive one.
 */
export const DANGER_ZONE_LAYER = 'Danger zone';

/** the red the whole zone strokes in, straight through the ByLayer colour */
export const DANGER_ZONE_COLOR = '#e5484d';

/** the zone's layer, or null when the document has never had one */
export function dangerZoneLayer(session: EditorSession): Layer | null {
  return (
    session.doc.layersList().find((l) => l.name === DANGER_ZONE_LAYER) ?? null
  );
}

/**
 * Is this entity part of the danger zone?
 *
 * Takes a DOCUMENT rather than a session, so the readers that only ever have
 * one — the estimator's walk among them — can ask without being handed an
 * editor. The layer's NAME is the identity, exactly as `dangerZoneLayer` has
 * it: a reopened document has to be recognised as holding a zone.
 */
export function isDangerZoneEntity(
  doc: DrawingDocument,
  entity: { layerId: LayerId },
): boolean {
  const layer = doc.getLayer(entity.layerId);
  return layer?.name === DANGER_ZONE_LAYER;
}

/** is the mode on right now? */
export function isDangerZoneOn(ui: EditorUi): boolean {
  return ui.dangerZone.get() !== null;
}

/** where new work goes once the zone closes — dropped if that layer is gone */
function returnLayer(
  session: EditorSession,
  id: LayerId | null,
): LayerId | null {
  return id !== null && session.doc.getLayer(id) ? id : null;
}

/**
 * Open the zone: reveal its work (creating the layer the first time round),
 * lock everything else, and point new work at it.
 *
 * One history group, so the whole switch is one Ctrl+Z — a mode change that
 * takes four undos to walk back is a mode change nobody trusts.
 */
export function enterDangerZone(session: EditorSession, ui: EditorUi): void {
  if (isDangerZoneOn(ui)) return;

  session.history.beginGroup();
  try {
    const existing = dangerZoneLayer(session);
    const layerId = existing
      ? existing.id
      : session.dispatch<LayerId>('LAYER.ADD', {
          name: DANGER_ZONE_LAYER,
          color: DANGER_ZONE_COLOR,
        });
    // a returning zone comes back hidden, and the colour is re-asserted in
    // case the document was written by something that never set one
    if (existing) {
      session.dispatch('LAYER.UPDATE', {
        id: layerId,
        visible: true,
        locked: false,
        color: DANGER_ZONE_COLOR,
      });
    }
    for (const layer of session.doc.layersList()) {
      if (layer.id === layerId) continue;
      session.dispatch('LAYER.UPDATE', { id: layer.id, locked: true });
    }
    ui.dangerZone.set({ layerId, returnLayerId: ui.activeLayerId.get() });
    ui.activeLayerId.set(layerId);
  } finally {
    session.history.endGroup();
  }

  // whatever was selected belongs to the plan that just went read-only, and a
  // selection of things that can no longer be edited only offers dead buttons
  session.selection.clear();
}

/**
 * Close the zone: hide its work and hand the original plan back, editable.
 *
 * The work is hidden rather than deleted — this is a toggle, and the next press
 * has to find everything exactly where it was left.
 */
export function leaveDangerZone(session: EditorSession, ui: EditorUi): void {
  const state = ui.dangerZone.get();
  if (!state) return;

  // New/Open can replace the whole document under an open zone and take its
  // layer with it — then there is nothing left to close but the mode itself
  if (!session.doc.getLayer(state.layerId)) {
    ui.activeLayerId.set(returnLayer(session, state.returnLayerId));
    ui.dangerZone.set(null);
    return;
  }

  session.history.beginGroup();
  try {
    // hidden AND locked: hiding is what the user asked for, and the lock is
    // what stops the healing pass behind a later edit to the original plan
    // from splitting or absorbing work nobody can currently see
    session.dispatch('LAYER.UPDATE', {
      id: state.layerId,
      visible: false,
      locked: true,
    });
    for (const layer of session.doc.layersList()) {
      if (layer.id === state.layerId) continue;
      session.dispatch('LAYER.UPDATE', { id: layer.id, locked: false });
    }
    ui.activeLayerId.set(returnLayer(session, state.returnLayerId));
    ui.dangerZone.set(null);
  } finally {
    session.history.endGroup();
  }

  // the selection may be holding zone work that just went invisible
  session.selection.clear();
}

export function toggleDangerZone(session: EditorSession, ui: EditorUi): void {
  if (isDangerZoneOn(ui)) leaveDangerZone(session, ui);
  else enterDangerZone(session, ui);
}

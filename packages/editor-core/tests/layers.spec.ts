import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LAYER_ID,
  EditorSession,
  buildDisplayList,
  isEntityInteractive,
  isEntityVisible,
  point,
} from '../src/index.js';
import type { EntityId, LayerId } from '../src/index.js';

function setup() {
  const session = new EditorSession();
  const layerId = session.dispatch<LayerId>('LAYER.ADD', { name: 'walls', color: '#e0b34d' });
  const wallId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(5, 0),
    layerId,
  });
  return { session, layerId, wallId };
}

describe('layer commands', () => {
  test('LAYER.UPDATE toggles flags and is undoable', () => {
    const { session, layerId } = setup();
    session.dispatch('LAYER.UPDATE', { id: layerId, visible: false, color: '#ff0000' });
    expect(session.doc.getLayer(layerId)!.visible).toBe(false);
    expect(session.doc.getLayer(layerId)!.color).toBe('#ff0000');
    session.undo();
    expect(session.doc.getLayer(layerId)!.visible).toBe(true);
    expect(session.doc.getLayer(layerId)!.color).toBe('#e0b34d');
  });

  test('LAYER.REMOVE blocked for default layer and layers in use', () => {
    const { session, layerId } = setup();
    expect(() => session.dispatch('LAYER.REMOVE', { id: DEFAULT_LAYER_ID })).toThrow(
      'default layer',
    );
    expect(() => session.dispatch('LAYER.REMOVE', { id: layerId })).toThrow('in use');
    const empty = session.dispatch<LayerId>('LAYER.ADD', { name: 'temp' });
    session.dispatch('LAYER.REMOVE', { id: empty });
    expect(session.doc.getLayer(empty)).toBeNull();
  });
});

describe('layer visibility and lock flow through the read paths', () => {
  test('hidden layer drops entities from display list and snapping', () => {
    const { session, layerId, wallId } = setup();
    expect(buildDisplayList(session.doc, { kind: 'plan', levelId: null }).length).toBe(1);
    expect(session.snap.snap(point(0, 0), 0.5)).not.toBeNull();

    session.dispatch('LAYER.UPDATE', { id: layerId, visible: false });
    expect(buildDisplayList(session.doc, { kind: 'plan', levelId: null }).length).toBe(0);
    expect(session.snap.snap(point(0, 0), 0.5)).toBeNull();
    expect(isEntityVisible(session.doc, session.doc.get(wallId)!)).toBe(false);
  });

  test('locked layer stays visible and snappable but not interactive', () => {
    const { session, layerId, wallId } = setup();
    session.dispatch('LAYER.UPDATE', { id: layerId, locked: true });
    const wall = session.doc.get(wallId)!;
    expect(isEntityVisible(session.doc, wall)).toBe(true);
    expect(session.snap.snap(point(0, 0), 0.5)).not.toBeNull();
    expect(isEntityInteractive(session.doc, wall)).toBe(false);
  });

  test('ByLayer color reaches the display list style', () => {
    const { session } = setup();
    const items = buildDisplayList(session.doc, { kind: 'plan', levelId: null });
    expect(items[0].style.stroke).toBe('#e0b34d');
  });
});

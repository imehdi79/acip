import { useState } from 'react';
import {
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconTrash,
} from '@tabler/icons-react';
import { DEFAULT_LAYER_ID, computeQuantities } from '@acip/editor-core';
import type { Layer } from '@acip/editor-core';
import { assembleBoq, defaultRules } from '@acip/estimator';
import { DEMO_RATES } from '../rates';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision, useSelectionIds } from '../hooks';
import { useStoreValue } from '../store';

export function Panels() {
  const session = useSession();
  useDocRevision(session);
  const selection = useSelectionIds(session);

  const single = selection.length === 1 ? session.doc.get(selection[0]) : null;
  const singleLength = single ? session.measure.lengthOf(single.id) : null;

  return (
    <aside className="panels">
      <section>
        <h3>Properties</h3>
        {selection.length === 0 && <p className="muted">No selection</p>}
        {selection.length > 1 && <p>{selection.length} entities selected</p>}
        {single && (
          <dl>
            <dt>Type</dt>
            <dd>{single.type}</dd>
            <dt>Layer</dt>
            <dd>{session.doc.getLayer(single.layerId)?.name ?? single.layerId}</dd>
            {singleLength !== null && (
              <>
                <dt>Length</dt>
                <dd>{singleLength.toFixed(3)} m</dd>
              </>
            )}
          </dl>
        )}
      </section>
      <LayersSection />
      <LevelsSection />
      <QuantitiesSection />
      <section>
        <h3>Entities</h3>
        <p>{session.doc.count} in document</p>
      </section>
    </aside>
  );
}

function QuantitiesSection() {
  const session = useSession();
  useDocRevision(session);
  const report = computeQuantities(session.doc);

  if (report.walls.length === 0) {
    return (
      <section>
        <h3>Quantities</h3>
        <p className="muted">Draw walls to see takeoff</p>
      </section>
    );
  }

  return (
    <section>
      <h3>Quantities</h3>
      <dl>
        <dt>Walls</dt>
        <dd>{report.walls.length}</dd>
        <dt>Length</dt>
        <dd>{report.totals.wallLength.toFixed(2)} m</dd>
        <dt>Face area</dt>
        <dd>{report.totals.wallNetFaceArea.toFixed(2)} m²</dd>
        <dt>Volume</dt>
        <dd>{report.totals.wallNetVolume.toFixed(2)} m³</dd>
        <dt>Windows</dt>
        <dd>{report.totals.windowCount}</dd>
        <dt>Doors</dt>
        <dd>{report.totals.doorCount}</dd>
      </dl>
      {report.materials.length > 0 && (
        <>
          <h3>Materials</h3>
          <dl>
            {report.materials.map((m) => (
              <MaterialRow key={m.materialId} name={m.name} volume={m.volume} />
            ))}
          </dl>
        </>
      )}
      <CostSection />
    </section>
  );
}

/** live BOQ: default measurement rules + demo rates, recomputed per commit */
function CostSection() {
  const session = useSession();
  const boq = assembleBoq(session.doc, { rules: defaultRules(), rates: DEMO_RATES });
  if (boq.lines.length === 0) return null;
  return (
    <>
      <h3>Cost (demo rates)</h3>
      <dl>
        {boq.lines.map((line) => (
          <CostRow
            key={line.costCode}
            label={line.description}
            value={
              line.amount !== null
                ? `${line.amount.toFixed(0)} ${boq.currency}`
                : `${line.quantity.toFixed(2)} ${line.unit} (no rate)`
            }
          />
        ))}
        <dt className="cost-total">Total</dt>
        <dd className="cost-total">
          {boq.total.toFixed(0)} {boq.currency}
        </dd>
      </dl>
    </>
  );
}

function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function MaterialRow({ name, volume }: { name: string; volume: number }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{volume.toFixed(2)} m³</dd>
    </>
  );
}

function LayersSection() {
  const session = useSession();
  const { ui } = useRuntime();
  useDocRevision(session);
  const activeLayerId = useStoreValue(ui.activeLayerId);
  const [name, setName] = useState('');

  const dispatch = (command: string, params: unknown) => {
    try {
      return session.dispatch(command, params);
    } catch (err) {
      ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
      return null;
    }
  };

  const addLayer = () => {
    if (!name.trim()) return;
    const id = dispatch('LAYER.ADD', { name: name.trim() });
    if (id) {
      ui.activeLayerId.set(id as never);
      setName('');
    }
  };

  return (
    <section>
      <h3>Layers</h3>
      <ul className="plain-list layers-list">
        {session.doc.layersList().map((layer: Layer) => {
          const isActive =
            activeLayerId === layer.id || (activeLayerId === null && layer.id === DEFAULT_LAYER_ID);
          return (
            <li key={layer.id} className="layer-row">
              <input
                type="color"
                className="layer-color"
                title="Layer color"
                value={layer.color ?? '#e0e0e0'}
                onChange={(e) => dispatch('LAYER.UPDATE', { id: layer.id, color: e.target.value })}
              />
              <button
                type="button"
                className={isActive ? 'layer-name active' : 'layer-name'}
                title="Set active layer"
                onClick={() =>
                  ui.activeLayerId.set(layer.id === DEFAULT_LAYER_ID ? null : (layer.id as never))
                }
              >
                {layer.name}
              </button>
              <button
                type="button"
                className="layer-flag"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={() =>
                  dispatch('LAYER.UPDATE', { id: layer.id, visible: !layer.visible })
                }
              >
                {layer.visible ? <IconEye size={14} stroke={1.75} /> : <IconEyeOff size={14} stroke={1.75} />}
              </button>
              <button
                type="button"
                className="layer-flag"
                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                onClick={() => dispatch('LAYER.UPDATE', { id: layer.id, locked: !layer.locked })}
              >
                {layer.locked ? <IconLock size={14} stroke={1.75} /> : <IconLockOpen size={14} stroke={1.75} />}
              </button>
              {layer.id !== DEFAULT_LAYER_ID && (
                <button
                  type="button"
                  className="layer-flag"
                  title="Delete layer (must be empty)"
                  onClick={() => {
                    if (activeLayerId === layer.id) ui.activeLayerId.set(null);
                    dispatch('LAYER.REMOVE', { id: layer.id });
                  }}
                >
                  <IconTrash size={14} stroke={1.75} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="level-form">
        <input
          placeholder="New layer"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addLayer();
            e.stopPropagation();
          }}
        />
        <button type="button" onClick={addLayer}>
          +
        </button>
      </div>
    </section>
  );
}

function LevelsSection() {
  const session = useSession();
  const { ui } = useRuntime();
  const activeLevelId = useStoreValue(ui.activeLevelId);
  const [name, setName] = useState('');
  const [elevation, setElevation] = useState('');

  const addLevel = () => {
    const value = Number(elevation);
    if (!name.trim() || !Number.isFinite(value)) {
      ui.appendLog('Level needs a name and a numeric elevation.', 'error');
      return;
    }
    try {
      const id = session.dispatch('LEVEL.ADD', { name: name.trim(), elevation: value });
      ui.activeLevelId.set(id as never);
      setName('');
      setElevation('');
    } catch (err) {
      ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <section>
      <h3>Levels</h3>
      {session.doc.levels.list().length === 0 ? (
        <p className="muted">No levels yet</p>
      ) : (
        <ul className="plain-list levels-list">
          {session.doc.levels.list().map((level) => (
            <li key={level.id} className="level-item">
              <button
                type="button"
                className={activeLevelId === level.id ? 'level-row active' : 'level-row'}
                onClick={() =>
                  ui.activeLevelId.set(activeLevelId === level.id ? null : level.id)
                }
              >
                {level.name} · {level.elevation.toFixed(2)}m
              </button>
              <button
                type="button"
                className="layer-flag"
                title="Duplicate floor (entities + openings)"
                onClick={() => {
                  try {
                    const id = session.dispatch('LEVEL.DUPLICATE', {
                      sourceLevelId: level.id,
                      name: `${level.name} copy`,
                      elevation: level.elevation + 3,
                    });
                    ui.activeLevelId.set(id as never);
                    ui.appendLog(`Duplicated ${level.name} — one undo step.`);
                  } catch (err) {
                    ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
                  }
                }}
              >
                <IconCopy size={14} stroke={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="level-form">
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <input
          placeholder="Elev."
          value={elevation}
          onChange={(e) => setElevation(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="button" onClick={addLevel}>
          +
        </button>
      </div>
    </section>
  );
}

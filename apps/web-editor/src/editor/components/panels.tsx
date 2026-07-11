import { useState } from 'react';
import { computeQuantities } from '@acip/editor-core';
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
      <section>
        <h3>Layers</h3>
        <ul className="plain-list">
          {session.doc.layersList().map((layer) => (
            <li key={layer.id}>{layer.name}</li>
          ))}
        </ul>
      </section>
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
    </section>
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
            <li key={level.id}>
              <button
                type="button"
                className={activeLevelId === level.id ? 'level-row active' : 'level-row'}
                onClick={() =>
                  ui.activeLevelId.set(activeLevelId === level.id ? null : level.id)
                }
              >
                {level.name} · {level.elevation.toFixed(2)}m
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

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
import type { AssemblyLayer, EntityTypeDef, Layer } from '@acip/editor-core';
import { assembleBoq, defaultRules } from '@acip/estimator';
import { DEMO_RATES } from '../rates';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision, useSelectionIds } from '../hooks';
import { useStoreValue } from '../store';

export function Panels() {
  const session = useSession();
  const { ui } = useRuntime();
  useDocRevision(session);
  const selection = useSelectionIds(session);

  const single = selection.length === 1 ? session.doc.get(selection[0]) : null;
  const singleLength = single ? session.measure.lengthOf(single.id) : null;

  // retype the selection when every selected entity is the same kind and
  // the catalog has types for it — the value-engineering dropdown
  const kinds = new Set(
    selection.map((id) => session.doc.get(id)?.type).filter((t): t is string => !!t),
  );
  const kind = kinds.size === 1 ? [...kinds][0] : null;
  const kindTypes = kind ? session.doc.types.list(kind) : [];
  const refs = new Set(selection.map((id) => session.doc.get(id)?.typeRef ?? ''));
  const commonRef = refs.size === 1 ? [...refs][0] : '';

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
        {selection.length > 0 && kindTypes.length > 0 && (
          <dl>
            <dt>Assembly</dt>
            <dd>
              <select
                value={commonRef}
                onChange={(e) => {
                  try {
                    session.dispatch('ENTITY.SETTYPE', {
                      ids: selection,
                      ...(e.target.value ? { typeId: e.target.value } : {}),
                    });
                  } catch (err) {
                    ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
                  }
                }}
              >
                <option value="">(local props)</option>
                {kindTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </dd>
          </dl>
        )}
      </section>
      <LayersSection />
      <LevelsSection />
      <CatalogSection />
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
              <MaterialRow key={m.materialId} name={m.name} quantity={m.quantity} unit={m.unit} />
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

function MaterialRow({ name, quantity, unit }: { name: string; quantity: number; unit: string }) {
  const label = unit === 'count' ? Math.ceil(quantity).toString() : quantity.toFixed(2);
  const suffix = unit === 'count' ? '' : ` ${unit === 'm3' ? 'm³' : unit === 'm2' ? 'm²' : unit}`;
  return (
    <>
      <dt>{name}</dt>
      <dd>
        {label}
        {suffix}
      </dd>
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

/**
 * Editable material library + type catalog. Text/number inputs commit on
 * blur or Enter (one transaction per edit, one undo); every change dispatches
 * the same MATERIAL/TYPE commands agents call, and instances re-derive
 * thickness and cost live.
 */
function CatalogSection() {
  const session = useSession();
  const { ui } = useRuntime();
  useDocRevision(session);
  const [matName, setMatName] = useState('');
  const [matCode, setMatCode] = useState('');
  const [typeName, setTypeName] = useState('');
  const [typeTarget, setTypeTarget] = useState('wall');

  const dispatch = (command: string, params: unknown): unknown => {
    try {
      return session.dispatch(command, params);
    } catch (err) {
      ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
      return null;
    }
  };

  const materials = session.doc.materials.list();
  const types = session.doc.types.list();

  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    e.stopPropagation();
  };

  const setLayers = (def: EntityTypeDef, layers: AssemblyLayer[]) => {
    dispatch('TYPE.UPDATE', {
      id: def.id,
      layers: layers.map((l) => ({ materialId: l.materialId, thickness: l.thickness })),
    });
  };

  return (
    <section>
      <h3>Materials</h3>
      <ul className="plain-list">
        {materials.map((m) => (
          <li key={m.id} className="level-form">
            <input
              key={`${m.id}:${m.name}`}
              defaultValue={m.name}
              title="Material name"
              onKeyDown={commitOnEnter}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== m.name) dispatch('MATERIAL.UPDATE', { id: m.id, name });
              }}
            />
            <input
              key={`${m.id}:${m.costCode ?? ''}`}
              defaultValue={m.costCode ?? ''}
              placeholder="cost code"
              title="Cost code for rate tables"
              onKeyDown={commitOnEnter}
              onBlur={(e) => {
                const costCode = e.target.value.trim();
                if (costCode && costCode !== (m.costCode ?? '')) {
                  dispatch('MATERIAL.UPDATE', { id: m.id, costCode });
                }
              }}
            />
            <select
              className="mat-unit"
              value={m.unit}
              title="Unit drives estimation: m³ by volume, m² by area, m by length, count ÷ coverage"
              onChange={(e) => dispatch('MATERIAL.UPDATE', { id: m.id, unit: e.target.value })}
            >
              <option value="m3">m³</option>
              <option value="m2">m²</option>
              <option value="m">m</option>
              <option value="count">count</option>
            </select>
            {m.unit === 'count' && (
              <input
                key={`${m.id}:cov:${m.coverage ?? ''}`}
                className="catalog-code"
                type="number"
                step="0.01"
                min="0.001"
                defaultValue={m.coverage ?? ''}
                placeholder="m²/unit"
                title="m² covered by one unit (tile face area)"
                onKeyDown={commitOnEnter}
                onBlur={(e) => {
                  const coverage = Number(e.target.value);
                  if (Number.isFinite(coverage) && coverage > 0 && coverage !== m.coverage) {
                    dispatch('MATERIAL.UPDATE', { id: m.id, coverage });
                  }
                }}
              />
            )}
            <button
              type="button"
              className="layer-flag"
              title="Delete material (must be unused)"
              onClick={() => dispatch('MATERIAL.REMOVE', { id: m.id })}
            >
              <IconTrash size={14} stroke={1.75} />
            </button>
          </li>
        ))}
      </ul>
      <div className="level-form">
        <input
          placeholder="New material"
          value={matName}
          onChange={(e) => setMatName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <input
          placeholder="cost code"
          value={matCode}
          onChange={(e) => setMatCode(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          onClick={() => {
            if (!matName.trim()) return;
            const params: Record<string, unknown> = { name: matName.trim() };
            if (matCode.trim()) params['costCode'] = matCode.trim();
            if (dispatch('MATERIAL.ADD', params)) {
              setMatName('');
              setMatCode('');
            }
          }}
        >
          +
        </button>
      </div>

      <h3>Types</h3>
      <ul className="plain-list">
        {types.map((def) => (
          <li key={def.id}>
            <div className="level-form">
              <input
                key={`${def.id}:${def.name}`}
                defaultValue={def.name}
                title={`${def.targetType} type name`}
                onKeyDown={commitOnEnter}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== def.name) dispatch('TYPE.UPDATE', { id: def.id, name });
                }}
              />
              <span className="muted">{def.targetType}</span>
              <button
                type="button"
                className="layer-flag"
                title="Delete type (must be unused)"
                onClick={() => dispatch('TYPE.REMOVE', { id: def.id })}
              >
                <IconTrash size={14} stroke={1.75} />
              </button>
            </div>
            {(def.layers ?? []).map((layer, i) => (
              <div key={`${def.id}:${i}`} className="level-form">
                <select
                  value={layer.materialId}
                  title="Layer material"
                  onChange={(e) => {
                    const layers = [...(def.layers ?? [])];
                    layers[i] = { ...layers[i], materialId: e.target.value as never };
                    setLayers(def, layers);
                  }}
                >
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input
                  key={`${def.id}:${i}:${layer.thickness}`}
                  defaultValue={layer.thickness}
                  title="Layer thickness in meters"
                  onKeyDown={commitOnEnter}
                  onBlur={(e) => {
                    const thickness = Number(e.target.value);
                    if (!Number.isFinite(thickness) || thickness <= 0) return;
                    if (thickness === layer.thickness) return;
                    const layers = [...(def.layers ?? [])];
                    layers[i] = { ...layers[i], thickness };
                    setLayers(def, layers);
                  }}
                />
                <button
                  type="button"
                  className="layer-flag"
                  title="Remove layer"
                  onClick={() => {
                    const layers = [...(def.layers ?? [])];
                    layers.splice(i, 1);
                    setLayers(def, layers);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {materials.length > 0 && (
              <div className="level-form">
                <select
                  value=""
                  title="Add an assembly layer"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setLayers(def, [
                      ...(def.layers ?? []),
                      { materialId: e.target.value as never, thickness: 0.05 },
                    ]);
                  }}
                >
                  <option value="">+ layer…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="level-form">
        <input
          placeholder="New type"
          value={typeName}
          onChange={(e) => setTypeName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <select value={typeTarget} onChange={(e) => setTypeTarget(e.target.value)}>
          <option value="wall">wall</option>
          <option value="slab">slab</option>
          <option value="roof">roof</option>
        </select>
        <button
          type="button"
          onClick={() => {
            if (!typeName.trim()) return;
            if (dispatch('TYPE.ADD', { targetType: typeTarget, name: typeName.trim() })) {
              setTypeName('');
            }
          }}
        >
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

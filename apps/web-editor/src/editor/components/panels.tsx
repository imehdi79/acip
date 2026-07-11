import { useSession } from '../session-context';
import { useDocRevision, useSelectionIds } from '../hooks';

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
      <section>
        <h3>Levels</h3>
        {session.doc.levels.list().length === 0 ? (
          <p className="muted">No levels yet</p>
        ) : (
          <ul className="plain-list">
            {session.doc.levels.list().map((level) => (
              <li key={level.id}>
                {level.name} · {level.elevation.toFixed(2)}m
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Entities</h3>
        <p>{session.doc.count} in document</p>
      </section>
    </aside>
  );
}

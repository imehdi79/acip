import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconCheck,
  IconCloudUpload,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { serverUrl } from '../../editor/agent';
import './admin.css';

interface RateRow {
  id: number;
  costCode: string;
  description: string;
  unit: string;
  unitCost: number;
  currency: string;
  status: 'staged' | 'published';
  sourceFile: string;
  sourceHint: string | null;
}

interface PricingRequest {
  id: number;
  kind: string;
  text: string;
  context: string | null;
  status: string;
}

const UNITS = ['m3', 'm2', 'm', 'count'];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${serverUrl()}/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 300) || response.statusText);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * The office side of pricing: upload a price list, the extraction agent
 * stages rows (never publishes on its own), the admin verifies each row
 * against its quoted source line, edits, and publishes. Published rows are
 * the rate table every editor loads. Open missing-price requests from field
 * users show alongside so the loop closes in one place.
 */
export function AdminPage() {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [requests, setRequests] = useState<PricingRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [rateRows, open] = await Promise.all([
        api<RateRow[]>('/rates'),
        api<PricingRequest[]>('/requests?status=open'),
      ]);
      setRows(rateRows);
      setRequests(open);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ingest = async (fileName: string, content: string) => {
    setBusy(true);
    setMessage('Extracting rates — the agent is reading the file…');
    setError('');
    try {
      const result = await api<{ staged: number }>('/rates/ingest', {
        method: 'POST',
        body: JSON.stringify({ fileName, content }),
      });
      setMessage(
        `${result.staged} rows staged from ${fileName} — review and publish below.`,
      );
      await refresh();
    } catch (err) {
      setMessage('');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void ingest(file.name, String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const patchRow = async (id: number, patch: Partial<RateRow>) => {
    try {
      const updated = await api<RateRow>(`/rates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setRows((current) => current.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteRow = async (id: number) => {
    try {
      await api(`/rates/${id}`, { method: 'DELETE' });
      setRows((current) => current.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const publishAll = async () => {
    try {
      const result = await api<{ published: number }>('/rates/publish-all', {
        method: 'PATCH',
      });
      setMessage(`${result.published} rows published.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const closeRequest = async (id: number) => {
    try {
      await api(`/requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
      });
      setRequests((current) => current.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const staged = rows.filter((r) => r.status === 'staged');
  const published = rows.filter((r) => r.status === 'published');

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>Rates &amp; pricing</h1>
        <button type="button" onClick={() => void refresh()} title="Reload">
          <IconRefresh size={15} stroke={1.75} /> Refresh
        </button>
      </header>

      {error && <p className="admin-error">{error}</p>}
      {message && <p className="admin-message">{message}</p>}

      <section>
        <h2>Upload a price list</h2>
        <p className="admin-hint">
          CSV or plain text. The extraction agent stages rows — nothing goes
          live until you publish it.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.md,.tsv,.json"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <IconCloudUpload size={15} stroke={1.75} />
          {busy ? 'Extracting…' : 'Upload & extract'}
        </button>
      </section>

      <section>
        <div className="admin-section-head">
          <h2>Staged ({staged.length})</h2>
          {staged.length > 0 && (
            <button type="button" onClick={() => void publishAll()}>
              <IconCheck size={15} stroke={1.75} /> Publish all
            </button>
          )}
        </div>
        {staged.length === 0 ? (
          <p className="admin-hint">Nothing awaiting review.</p>
        ) : (
          <RateTable
            rows={staged}
            onPatch={patchRow}
            onDelete={deleteRow}
            action="publish"
          />
        )}
      </section>

      <section>
        <h2>Published ({published.length})</h2>
        {published.length === 0 ? (
          <p className="admin-hint">
            No published rates yet — editors use the demo table.
          </p>
        ) : (
          <RateTable
            rows={published}
            onPatch={patchRow}
            onDelete={deleteRow}
            action="unpublish"
          />
        )}
      </section>

      <section>
        <h2>Open pricing requests ({requests.length})</h2>
        {requests.length === 0 ? (
          <p className="admin-hint">No open requests from the field.</p>
        ) : (
          <ul className="admin-requests">
            {requests.map((request) => (
              <li key={request.id}>
                <span className="admin-request-kind">{request.kind}</span>
                <span className="admin-request-text">
                  {request.text}
                  {request.context ? ` — ${request.context}` : ''}
                </span>
                <button
                  type="button"
                  title="Mark done"
                  onClick={() => void closeRequest(request.id)}
                >
                  <IconCheck size={14} stroke={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RateTable({
  rows,
  onPatch,
  onDelete,
  action,
}: {
  rows: RateRow[];
  onPatch: (id: number, patch: Partial<RateRow>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  action: 'publish' | 'unpublish';
}) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Cost code</th>
          <th>Description</th>
          <th>Unit</th>
          <th>Rate</th>
          <th>Cur.</th>
          <th>Source</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <input
                key={`${row.id}:${row.costCode}`}
                defaultValue={row.costCode}
                onBlur={(e) => {
                  const costCode = e.target.value.trim();
                  if (costCode && costCode !== row.costCode)
                    void onPatch(row.id, { costCode });
                }}
              />
            </td>
            <td>
              <input
                key={`${row.id}:${row.description}`}
                defaultValue={row.description}
                onBlur={(e) => {
                  const description = e.target.value.trim();
                  if (description && description !== row.description)
                    void onPatch(row.id, { description });
                }}
              />
            </td>
            <td>
              <select
                value={row.unit}
                onChange={(e) => void onPatch(row.id, { unit: e.target.value })}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <input
                key={`${row.id}:${row.unitCost}`}
                className="admin-number"
                type="number"
                step="0.01"
                min="0"
                defaultValue={row.unitCost}
                onBlur={(e) => {
                  const unitCost = Number(e.target.value);
                  if (Number.isFinite(unitCost) && unitCost !== row.unitCost)
                    void onPatch(row.id, { unitCost });
                }}
              />
            </td>
            <td>
              <input
                key={`${row.id}:${row.currency}`}
                className="admin-currency"
                defaultValue={row.currency}
                onBlur={(e) => {
                  const currency = e.target.value.trim().toUpperCase();
                  if (currency && currency !== row.currency)
                    void onPatch(row.id, { currency });
                }}
              />
            </td>
            <td
              className="admin-source"
              title={row.sourceHint ?? row.sourceFile}
            >
              {row.sourceFile}
              {row.sourceHint ? ` · “${row.sourceHint}”` : ''}
            </td>
            <td className="admin-actions">
              <button
                type="button"
                title={action === 'publish' ? 'Publish' : 'Back to staged'}
                onClick={() =>
                  void onPatch(row.id, {
                    status: action === 'publish' ? 'published' : 'staged',
                  })
                }
              >
                <IconCheck size={14} stroke={1.75} />
              </button>
              <button
                type="button"
                title="Delete row"
                onClick={() => void onDelete(row.id)}
              >
                <IconTrash size={14} stroke={1.75} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default AdminPage;

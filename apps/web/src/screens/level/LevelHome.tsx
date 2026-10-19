import { frustumCapacityLitres } from '@senselab/dsp';
import { api } from '../../lib/api';
import { Link } from '../../lib/router';
import { useAsync } from '../../lib/useAsync';

export function LevelHome() {
  const { data, error, loading } = useAsync(() => api.listContainers(), 'containers');
  return (
    <section className="stack">
      <div>
        <h1>🪣 Liquid level</h1>
        <p className="muted">
          Save each bucket once, calibrate it with a couple of known fills, then measure by tapping.
        </p>
      </div>
      <Link href="/level/new" className="button primary-link">
        + New container
      </Link>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">Couldn’t load containers: {error}</p>}
      {data && data.length === 0 && <div className="card muted">No containers yet.</div>}
      {data && data.length > 0 && (
        <ul className="list">
          {data.map((c) => (
            <li key={c.id}>
              <Link href={`/level/${c.id}`} className="list-item">
                <strong>{c.name}</strong>
                <span className="muted small">
                  {c.shape
                    ? `${frustumCapacityLitres(c.shape).toFixed(1)} L capacity`
                    : 'No dimensions'}
                  {c.material ? ` · ${c.material}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="card small muted">
        Methods: <strong>tap</strong> (ready) · echo ranging (next) · camera dimensions (after
        that).
      </div>
      <Link href="/">← All modes</Link>
    </section>
  );
}

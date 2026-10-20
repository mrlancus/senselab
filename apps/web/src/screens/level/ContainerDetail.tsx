import { useMemo, useState } from 'react';
import {
  estimateLitresFromTaps,
  fitTapCalibration,
  frustumCapacityLitres,
  frustumLevelForLitres,
  type TapEstimate,
  type TapFit,
} from '@senselab/dsp';
import type { CalibrationPoint } from '@senselab/shared';
import { CalibrationChart } from '../../components/CalibrationChart';
import { HowTo } from '../../components/howto/HowTo';
import { EmptyBucketAnim, FillBucketAnim } from '../../components/howto/animations';
import { LitresGauge } from '../../components/LitresGauge';
import { TapCapture, type TapCaptureResult } from '../../components/TapCapture';
import { api, type ContainerDetail as Detail } from '../../lib/api';
import { useDebug } from '../../lib/debug';
import { Link, navigate } from '../../lib/router';
import { useAsync } from '../../lib/useAsync';
import { ConfidencePill } from './ConfidencePill';
import { EchoCalibrate, EchoMeasure } from './EchoLevel';

type Method = 'tap' | 'echo' | 'camera';
const UNIT: Record<string, string> = { tap: 'Hz', echo: 'cm', camera: 'cm' };

export function ContainerDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => api.getContainer(id), id);
  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error || !data) {
    return (
      <section className="stack">
        <p className="error">{error ?? 'Not found'}</p>
        <Link href="/level">← Containers</Link>
      </section>
    );
  }
  return <DetailView c={data} reload={reload} />;
}

function tryFit(points: CalibrationPoint[]): { fit: TapFit | null; why: string | null } {
  const tap = points.filter((p) => p.method === 'tap');
  if (tap.length < 2) return { fit: null, why: null };
  try {
    return {
      fit: fitTapCalibration(
        tap.map((p) => ({ litres: p.knownLitres, frequency: p.measuredValue })),
      ),
      why: null,
    };
  } catch (e) {
    return { fit: null, why: e instanceof Error ? e.message : String(e) };
  }
}

function DetailView({ c, reload }: { c: Detail; reload: () => void }) {
  const debug = useDebug();
  const tapPoints = c.calibration.filter((p) => p.method === 'tap');
  const echoPoints = c.calibration.filter((p) => p.method === 'echo');
  const [method, setMethod] = useState<Method>(
    !tapPoints.length && echoPoints.length ? 'echo' : 'tap',
  );
  const { fit, why } = useMemo(() => tryFit(c.calibration), [c.calibration]);
  const capacity = c.shape ? frustumCapacityLitres(c.shape) : undefined;
  const [mode, setMode] = useState<'measure' | 'calibrate'>(fit ? 'measure' : 'calibrate');
  const [last, setLast] = useState<{ est: TapEstimate; frequency: number } | null>(null);

  const remove = async () => {
    if (!confirm(`Delete “${c.name}” and all its calibration and measurements?`)) return;
    await api.deleteContainer(c.id);
    navigate('/level', { replace: true });
  };

  return (
    <section className="stack">
      <div>
        <Link href="/level" className="small">
          ← Containers
        </Link>
        <h1>{c.name}</h1>
        <p className="muted small">
          {capacity ? `${capacity.toFixed(1)} L capacity` : 'No dimensions'}
          {c.material ? ` · ${c.material}` : ''} · {tapPoints.length} tap / {echoPoints.length} echo
          calibration point
          {tapPoints.length + echoPoints.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="segmented" role="tablist" aria-label="Method">
        {(['tap', 'echo', 'camera'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={method === m}
            className={method === m ? 'on' : ''}
            onClick={() => setMethod(m)}
          >
            {m === 'tap' ? '🥄 Tap' : m === 'echo' ? '📡 Echo' : '📷 Camera'}
          </button>
        ))}
      </div>

      {method === 'camera' && (
        <div className="card stack">
          <p>
            The camera measures the bucket's inside dimensions (a bank card is the ruler), and for
            translucent buckets, the water level through the wall.
          </p>
          <Link href={`/level/${c.id}/camera`} className="button block">
            Measure dimensions
          </Link>
          <Link href={`/level/${c.id}/waterline`} className="button block">
            Waterline photo (translucent buckets)
          </Link>
        </div>
      )}

      <div className="segmented" role="tablist" hidden={method === 'camera'}>
        <button
          role="tab"
          aria-selected={mode === 'measure'}
          className={mode === 'measure' ? 'on' : ''}
          onClick={() => setMode('measure')}
        >
          Measure
        </button>
        <button
          role="tab"
          aria-selected={mode === 'calibrate'}
          className={mode === 'calibrate' ? 'on' : ''}
          onClick={() => setMode('calibrate')}
        >
          Calibrate
        </button>
      </div>

      {method === 'echo' && mode === 'measure' && (
        <EchoMeasure c={c} reload={reload} goCalibrate={() => setMode('calibrate')} />
      )}
      {method === 'echo' && mode === 'calibrate' && <EchoCalibrate c={c} reload={reload} />}
      {method === 'tap' && mode === 'measure' && (
        <Measure
          c={c}
          fit={fit}
          why={why}
          capacity={capacity}
          last={last}
          setLast={setLast}
          reload={reload}
          goCalibrate={() => setMode('calibrate')}
        />
      )}
      {method === 'tap' && mode === 'calibrate' && (
        <Calibrate
          c={c}
          points={tapPoints}
          fit={fit}
          reload={reload}
          onReady={() => setMode('measure')}
        />
      )}

      {method === 'echo' && echoPoints.length > 0 && (
        <div className="card stack">
          <h2>Echo calibration</h2>
          <ul className="list compact">
            {echoPoints.map((p) => (
              <li key={p.id} className="list-item row" style={{ justifyContent: 'space-between' }}>
                <span className="mono">
                  {p.knownLitres} L → {p.measuredValue.toFixed(1)} cm
                </span>
                <button
                  className="small danger"
                  onClick={async () => {
                    await api.deleteCalibration(c.id, p.id);
                    reload();
                  }}
                  aria-label={`Delete ${p.knownLitres} L echo point`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {method === 'tap' && (tapPoints.length > 0 || debug) && (
        <div className="card stack">
          <h2>Calibration curve</h2>
          {tapPoints.length ? (
            <CalibrationChart
              points={tapPoints.map((p) => ({ litres: p.knownLitres, frequency: p.measuredValue }))}
              fit={fit}
              reading={last ? { frequency: last.frequency, litres: last.est.litres } : null}
            />
          ) : (
            <p className="muted">No points yet.</p>
          )}
          {fit && (
            <p className="muted small mono">
              {fit.model.kind === 'power'
                ? `(f₀/f)² − 1 = ${fit.model.alpha.toExponential(3)}·V^${fit.model.k.toFixed(2)}${fit.model.kRange ? ` (k assumed, ${fit.model.kRange[0]}–${fit.model.kRange[1]})` : ''}, f₀ = ${fit.model.f0.toFixed(1)} Hz`
                : 'monotone interpolation (no empty point, or pitch did not follow the mass-loading law)'}
              {fit.residualRmsLitres > 0.001
                ? ` · residual ${fit.residualRmsLitres.toFixed(2)} L`
                : ''}
            </p>
          )}
          <ul className="list compact">
            {tapPoints.map((p) => (
              <li key={p.id} className="list-item row" style={{ justifyContent: 'space-between' }}>
                <span className="mono">
                  {p.knownLitres} L → {p.measuredValue.toFixed(1)} Hz
                </span>
                <button
                  className="small danger"
                  onClick={async () => {
                    await api.deleteCalibration(c.id, p.id);
                    reload();
                  }}
                  aria-label={`Delete ${p.knownLitres} L point`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.measurements.length > 0 && (
        <div className="card stack">
          <h2>Recent measurements</h2>
          <ul className="list compact">
            {c.measurements.slice(0, 8).map((m) => (
              <li key={m.id} className="list-item row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{m.estimatedLitres.toFixed(1)} L</strong>{' '}
                  <span className="muted small">
                    {m.method} · {m.rawValue.toFixed(1)} {UNIT[m.method] ?? ''} ·{' '}
                    {(m.confidence * 100).toFixed(0)}%
                  </span>
                </span>
                <span className="muted small">{new Date(m.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row">
        <Link href={`/level/${c.id}/edit`} className="button">
          Edit
        </Link>
        <button className="danger" onClick={remove}>
          Delete
        </button>
      </div>
    </section>
  );
}

function Measure({
  c,
  fit,
  why,
  capacity,
  last,
  setLast,
  reload,
  goCalibrate,
}: {
  c: Detail;
  fit: TapFit | null;
  why: string | null;
  capacity?: number;
  last: { est: TapEstimate; frequency: number } | null;
  setLast: (v: { est: TapEstimate; frequency: number }) => void;
  reload: () => void;
  goCalibrate: () => void;
}) {
  const [saving, setSaving] = useState(false);
  if (!fit) {
    return (
      <div className="card stack">
        <p>
          {why ??
            'This container needs at least two calibration points (empty plus one known fill) before it can measure.'}
        </p>
        <button className="primary block" onClick={goCalibrate}>
          Calibrate
        </button>
      </div>
    );
  }
  const onResult = async (r: TapCaptureResult) => {
    const est = estimateLitresFromTaps(fit, r.summary, capacity);
    setLast({ est, frequency: r.summary.frequency });
    setSaving(true);
    try {
      await api.addMeasurement(c.id, {
        method: 'tap',
        rawValue: r.summary.frequency,
        estimatedLitres: est.litres,
        confidence: est.confidence,
        recordingKey: r.recordingKey,
      });
      reload();
    } finally {
      setSaving(false);
    }
  };
  const gaugeCap = capacity ?? fit.maxLitres;
  return (
    <div className="stack">
      {last && (
        <div className="card result">
          <LitresGauge litres={last.est.litres} capacity={gaugeCap} shape={c.shape} />
          <div className="stack" style={{ gap: 4 }}>
            <span className="big-number">≈ {last.est.litres.toFixed(1)} L</span>
            <span className="muted mono">± {last.est.uncertaintyLitres.toFixed(1)} L</span>
            {c.shape && (
              <span className="small">
                water ≈ {frustumLevelForLitres(c.shape, last.est.litres).toFixed(1)} cm deep
              </span>
            )}
            <ConfidencePill value={last.est.confidence} />
            {last.est.shapeUncertaintyLitres > 0.05 && (
              <span className="small warn-text">
                Calibrated with one fill only, so the curve shape between fills is assumed. Add
                another known fill to tighten this.
              </span>
            )}
            {!last.est.inRange && (
              <span className="small warn-text">
                Outside the calibrated range. Add a calibration point near this fill.
              </span>
            )}
            {saving && <span className="muted small">Saving…</span>}
          </div>
        </div>
      )}
      <TapCapture
        band={fit.searchBand}
        level={last ? last.est.litres / gaugeCap : 0.5}
        actionLabel="Show litres"
        labels={{ container: c.name, containerId: c.id, purpose: 'measure' }}
        onResult={onResult}
      />
    </div>
  );
}

function Calibrate({
  c,
  points,
  fit,
  reload,
  onReady,
}: {
  c: Detail;
  points: CalibrationPoint[];
  fit: TapFit | null;
  reload: () => void;
  onReady: () => void;
}) {
  const hasEmpty = points.some((p) => p.knownLitres === 0);
  const capacity = c.shape ? frustumCapacityLitres(c.shape) : null;
  const suggested = !hasEmpty
    ? 0
    : points.length === 1
      ? capacity
        ? Math.round(capacity / 2)
        : 5
      : capacity
        ? Math.floor(capacity * 0.9)
        : 10;
  const [litres, setLitres] = useState(String(suggested));
  const [saved, setSaved] = useState<string | null>(null);
  const known = parseFloat(litres.replace(',', '.'));
  const valid = known >= 0 && known < 1000;

  const onResult = async (r: TapCaptureResult) => {
    await api.addCalibration(c.id, {
      method: 'tap',
      knownLitres: known,
      measuredValue: r.summary.frequency,
      recordingKey: r.recordingKey,
    });
    setSaved(`Saved: ${known} L → ${r.summary.frequency.toFixed(1)} Hz`);
    reload();
  };

  const nextTip = !hasEmpty
    ? 'Start with the container empty and dry (0 L).'
    : points.length === 1
      ? 'Now pour in a measured amount (a jug with markings), e.g. half full.'
      : points.length === 2
        ? 'Add a second known fill (e.g. nearly full). With only one fill the curve shape is guessed.'
        : 'Add another known fill to improve the curve.';

  return (
    <div className="stack">
      <HowTo
        compact
        steps={[
          {
            art: <EmptyBucketAnim />,
            title: 'Empty first',
            text: 'Calibrate the empty container: 0 L.',
          },
          {
            art: <FillBucketAnim />,
            title: 'Then known fills',
            text: 'Pour a measured amount, enter it, and tap. Two or three points are enough.',
          },
        ]}
      />
      <div className="card stack">
        <p>
          <strong>Next:</strong> {nextTip}
        </p>
        <label>
          Litres in the container right now
          <input inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value)} />
        </label>
        {valid ? (
          <TapCapture
            key={points.length}
            level={capacity ? Math.min(1, known / capacity) : Math.min(1, known / 10)}
            actionLabel={`Save as ${known} L`}
            labels={{ container: c.name, containerId: c.id, purpose: 'calibrate', litres: known }}
            onResult={onResult}
          />
        ) : (
          <p className="error">Enter the litres in the container.</p>
        )}
        {saved && <p className="ok-note">{saved}</p>}
      </div>
      {fit && (
        <button className="primary block" onClick={onReady}>
          Calibration ready: measure →
        </button>
      )}
    </div>
  );
}

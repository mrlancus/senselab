import { useMemo, useState } from 'react';
import {
  estimateLitresFromEcho,
  fitEchoLevel,
  frustumCapacityLitres,
  type EchoLevelEstimate,
} from '@senselab/dsp';
import { EchoCapture, type EchoCaptureResult } from '../../components/EchoCapture';
import { EmptyBucketAnim, PhoneOverBucketAnim } from '../../components/howto/animations';
import { LitresGauge } from '../../components/LitresGauge';
import { api, type ContainerDetail } from '../../lib/api';
import { ConfidencePill } from './ConfidencePill';

const holdStep = (level: number) => ({
  art: <PhoneOverBucketAnim level={level} />,
  title: 'Phone upright over the middle',
  text: 'Bottom edge (speaker and mic) pointing straight down at the water, level with the rim. Hold it the same way every time; resting your wrist on the rim helps.',
});

function useEchoFit(c: ContainerDetail) {
  const points = c.calibration.filter((p) => p.method === 'echo');
  const fit = useMemo(
    () =>
      fitEchoLevel(
        points.map((p) => ({ litres: p.knownLitres, rawCm: p.measuredValue })),
        c.shape,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.calibration, c.shape],
  );
  return { points, fit };
}

/** Bucket litres by echo ranging. */
export function EchoMeasure({
  c,
  reload,
  goCalibrate,
}: {
  c: ContainerDetail;
  reload: () => void;
  goCalibrate: () => void;
}) {
  const { fit } = useEchoFit(c);
  const capacity = c.shape ? frustumCapacityLitres(c.shape) : undefined;
  const [last, setLast] = useState<EchoLevelEstimate | null>(null);

  if (!fit) {
    return (
      <div className="card stack">
        <p>
          Echo needs either the bucket's inside dimensions (Edit) or two echo calibration points, to
          turn a distance into litres.
        </p>
        <button className="primary block" onClick={goCalibrate}>
          Calibrate
        </button>
      </div>
    );
  }

  const maxCm = c.shape ? c.shape.heightCm - fit.offsetCm + 8 : fit.rangeCm[1] + 10;
  const estimate = (r: EchoCaptureResult['analysis']) =>
    r.best
      ? estimateLitresFromEcho(
          fit,
          { rawCm: r.best.rawCm, spreadCm: r.spreadCm, confidence: r.confidence },
          capacity,
        )
      : null;

  const onResult = async (r: EchoCaptureResult) => {
    const est = estimate(r.analysis);
    if (!est || !r.analysis.best) return;
    setLast(est);
    await api.addMeasurement(c.id, {
      method: 'echo',
      rawValue: r.analysis.best.rawCm,
      estimatedLitres: est.litres,
      confidence: est.confidence,
      recordingKey: r.recordingKey,
    });
    reload();
  };

  const gaugeCap = capacity ?? Math.max(1, ...c.calibration.map((p) => p.knownLitres));
  return (
    <div className="stack">
      {!fit.calibrated && (
        <p className="notice small">
          Not calibrated yet: this assumes the phone's bottom edge is level with the rim (±1.5 cm,
          so about ±{(fit.slope((c.shape?.heightCm ?? 20) / 2) * 1.5).toFixed(1)} L). One echo
          reading of the empty bucket fixes that.{' '}
          <button className="link" onClick={goCalibrate}>
            Calibrate
          </button>
        </p>
      )}
      {last && (
        <div className="card result">
          <LitresGauge litres={last.litres} capacity={gaugeCap} shape={c.shape} />
          <div className="stack" style={{ gap: 4 }}>
            <span className="big-number">≈ {last.litres.toFixed(1)} L</span>
            <span className="muted mono">± {last.uncertaintyLitres.toFixed(1)} L</span>
            {last.depthCm != null && (
              <span className="small">water ≈ {last.depthCm.toFixed(1)} cm deep</span>
            )}
            <span className="small muted">
              surface {last.distanceCm.toFixed(1)} cm below the rim
            </span>
            <ConfidencePill value={last.confidence} />
            {!last.inRange && (
              <span className="small warn-text">
                That distance doesn't fit this bucket. Check the phone points straight down.
              </span>
            )}
          </div>
        </div>
      )}
      <EchoCapture
        steps={[holdStep(last && gaugeCap ? last.litres / gaugeCap : 0.5)]}
        maxCm={Math.min(140, maxCm)}
        offsetCm={fit.offsetCm}
        actionLabel="Show litres"
        labels={{ container: c.name, containerId: c.id, purpose: 'measure' }}
        onResult={onResult}
        renderResult={(a) => {
          const e = estimate(a);
          return e ? (
            <span>
              Surface <strong className="mono">{e.distanceCm.toFixed(1)} cm</strong> below the rim
            </span>
          ) : null;
        }}
      />
    </div>
  );
}

/** Echo calibration: one reading at a known fill (empty is easiest) per point. */
export function EchoCalibrate({ c, reload }: { c: ContainerDetail; reload: () => void }) {
  const { points } = useEchoFit(c);
  const hasEmpty = points.some((p) => p.knownLitres === 0);
  const [litres, setLitres] = useState(hasEmpty ? '' : '0');
  const [saved, setSaved] = useState<string | null>(null);
  const known = parseFloat(litres.replace(',', '.'));
  const valid = known >= 0 && known < 1000;
  const maxCm = c.shape ? c.shape.heightCm + 30 : 100;

  const onResult = async (r: EchoCaptureResult) => {
    if (!r.analysis.best) return;
    await api.addCalibration(c.id, {
      method: 'echo',
      knownLitres: known,
      measuredValue: r.analysis.best.rawCm,
      recordingKey: r.recordingKey,
    });
    setSaved(`Saved: ${known} L → ${r.analysis.best.rawCm.toFixed(1)} cm`);
    reload();
  };

  return (
    <div className="stack">
      <p className="small">
        {c.shape
          ? 'With dimensions, one reading of the empty bucket is enough: it measures how high you hold the phone. More points average that out.'
          : 'Without dimensions, take readings at two or more known fills (e.g. empty and full).'}
      </p>
      <label>
        Litres in the container right now
        <input inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value)} />
      </label>
      {valid ? (
        <EchoCapture
          key={points.length}
          steps={[
            ...(known === 0
              ? [{ art: <EmptyBucketAnim />, title: 'Empty bucket', text: 'Dry is best.' }]
              : []),
            holdStep(c.shape ? Math.min(1, known / frustumCapacityLitres(c.shape)) : 0.5),
          ]}
          maxCm={Math.min(140, maxCm)}
          actionLabel={`Save as ${known} L`}
          labels={{ container: c.name, containerId: c.id, purpose: 'calibrate', litres: known }}
          onResult={onResult}
          renderResult={(a) =>
            a.best ? (
              <span>
                Echo at <strong className="mono">{a.best.rawCm.toFixed(1)} cm</strong> (raw)
              </span>
            ) : null
          }
        />
      ) : (
        <p className="error">Enter the litres in the container.</p>
      )}
      {saved && <p className="ok-note">{saved}</p>}
    </div>
  );
}

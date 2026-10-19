import { useMemo, useState, type ReactNode } from 'react';
import { makeEchoTrain, type EchoAnalysis } from '@senselab/dsp';
import type { RecordingLabels } from '@senselab/shared';
import { audio, lastSampleRate } from '../audio/engine';
import { useDebug } from '../lib/debug';
import {
  clearReference,
  ECHO_WINDOW_CM,
  echoBand,
  echoConfig,
  loadAirTemp,
  loadReference,
  saveAirTemp,
  saveReference,
} from '../lib/echo';
import { Link } from '../lib/router';
import { runDsp } from '../workers/dsp-client';
import type { Handlers } from '../workers/dsp-handlers';
import { HowTo, type HowToStep } from './howto/HowTo';
import { FreeAirAnim } from './howto/animations';
import { LinePlot, Waveform } from './plots';
import { SaveRecording } from './SaveRecording';

const PAD_S = 0.25;

type EchoRun = ReturnType<Handlers['echo']>;

export interface EchoCaptureResult {
  analysis: EchoAnalysis;
  samples: Float32Array;
  sampleRate: number;
  recordingKey: string | null;
}

/**
 * Plays a chirp train, records it, and finds the strongest reflection in [minCm, maxCm].
 * On first use per device (and chirp band) it records a free-air reference, which removes
 * the phone's own ringing so close echoes can be read.
 */
export function EchoCapture({
  steps,
  minCm,
  maxCm,
  offsetCm = 0,
  expectRawCm,
  actionLabel,
  labels,
  onResult,
  onMeasured,
  renderResult,
}: {
  steps: HowToStep[];
  minCm?: number;
  maxCm: number;
  offsetCm?: number;
  expectRawCm?: number | null;
  actionLabel?: string;
  labels: RecordingLabels;
  onResult?: (r: EchoCaptureResult) => void;
  /** Called after every successful ping. */
  onMeasured?: (a: EchoAnalysis) => void;
  /** Shows the reading; defaults to the distance. */
  renderResult?: (a: EchoAnalysis) => ReactNode;
}) {
  const debug = useDebug();
  const [sr, setSr] = useState<number | null>(audio.info?.sampleRate ?? lastSampleRate());
  const cfg = useMemo(() => (sr ? echoConfig(sr) : null), [sr]);
  const [refVersion, setRefVersion] = useState(0);
  const reference = useMemo(
    () => (cfg ? loadReference(cfg) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg, refVersion],
  );
  const [skipRef, setSkipRef] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'pinging' | 'analysing' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<{ r: EchoRun; samples: Float32Array; emitIndex: number } | null>(
    null,
  );
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const [tempC, setTempC] = useState(loadAirTemp);
  const fromProfile = sr ? echoBand(sr).fromProfile : true;

  const ping = async (asReference: boolean) => {
    setError(null);
    setRecordingKey(null);
    try {
      const info = await audio.start();
      setSr(info.sampleRate);
      const c = echoConfig(info.sampleRate);
      const train = makeEchoTrain(c);
      setPhase('pinging');
      const { recorded, emitIndex } = await audio.playAndRecord(train.train, PAD_S);
      setPhase('analysing');
      const ref = asReference ? null : loadReference(c);
      const r = await runDsp('echo', recorded, emitIndex, c, ECHO_WINDOW_CM, {
        reference: ref,
        minCm,
        maxCm,
        offsetCm,
        expectRawCm,
        tempC,
      });
      // The direct path must stand well clear of the noise, or nothing else can be trusted.
      if (r.analysis.floorDb > -20) {
        setPhase('idle');
        setError(
          'The chirps were barely heard. Turn the volume up (and on iPhone, the ring/silent switch to ring).',
        );
        setRun({ r, samples: recorded, emitIndex });
        return;
      }
      if (asReference) {
        saveReference(c, r.corr);
        setRefVersion((v) => v + 1);
        setPhase('idle');
        setRun({ r, samples: recorded, emitIndex });
        return;
      }
      setRun({ r, samples: recorded, emitIndex });
      setPhase('done');
      onMeasured?.(r.analysis);
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const needsReference = !reference && !skipRef;
  const a = run?.r.analysis;
  const busy = phase === 'pinging' || phase === 'analysing';

  return (
    <div className="stack">
      {!fromProfile && (
        <p className="notice small">
          Using audible chirps (2–8 kHz), so you'll hear clicks.{' '}
          <Link href="/sensor-check">Run the sensor check</Link> to use quiet near-ultrasonic ones
          if this phone supports them.
        </p>
      )}

      {needsReference ? (
        <div className="card stack">
          <HowTo
            compact
            steps={[
              {
                art: <FreeAirAnim />,
                title: 'Once per phone: a free-air reference',
                text: 'Hold the phone up at arm’s length, bottom edge pointing at open space, with nothing within a metre below or in front. It learns its own echo-free sound.',
              },
            ]}
          />
          <button className="primary block" onClick={() => ping(true)} disabled={busy}>
            {busy ? 'Listening…' : 'Record reference'}
          </button>
          <button className="small" onClick={() => setSkipRef(true)} disabled={busy}>
            Skip (anything closer than ~17 cm can't be read)
          </button>
        </div>
      ) : (
        <>
          {phase !== 'done' && <HowTo compact steps={steps} />}
          {phase === 'done' && a && (
            <div className="card stack">
              {renderResult ? (
                renderResult(a)
              ) : a.distanceCm != null ? (
                <span className="big-number">{a.distanceCm.toFixed(1)} cm</span>
              ) : null}
              {!a.best && (
                <p className="notice">
                  No clear echo between {minCm ?? '—'} and {maxCm} cm. Point the bottom edge
                  straight at the surface, a little further away.
                </p>
              )}
              {a.best && a.runnerUpDb > -3 && (
                <p className="notice small">
                  Two echoes are almost equally strong (
                  {a.candidates
                    .slice(0, 2)
                    .map((k) => `${(k.rawCm + offsetCm).toFixed(1)} cm`)
                    .join(' and ')}
                  ). Hold the phone straighter and try again.
                </p>
              )}
              {a.best && onResult && actionLabel && (
                <button
                  className="primary block"
                  onClick={() => {
                    if (!run || !sr) return;
                    onResult({ analysis: a, samples: run.samples, sampleRate: sr, recordingKey });
                    setPhase('idle');
                  }}
                >
                  {actionLabel}
                </button>
              )}
            </div>
          )}
          <button
            className={phase === 'done' ? 'block' : 'primary block'}
            onClick={() => ping(false)}
            disabled={busy}
          >
            {phase === 'pinging'
              ? 'Pinging…'
              : phase === 'analysing'
                ? 'Finding the echo…'
                : phase === 'done'
                  ? 'Ping again'
                  : 'Ping'}
          </button>
          <div className="row small muted" style={{ justifyContent: 'space-between' }}>
            <label className="inline">
              Air
              <input
                className="mini"
                inputMode="decimal"
                value={tempC}
                onChange={(e) => {
                  const v = parseFloat(e.target.value.replace(',', '.'));
                  if (Number.isFinite(v) && v > -30 && v < 60) {
                    setTempC(v);
                    saveAirTemp(v);
                  }
                }}
                aria-label="Air temperature in °C"
              />
              °C
            </label>
            {reference && cfg && (
              <button
                className="small"
                onClick={() => {
                  clearReference(cfg);
                  setSkipRef(false);
                  setRefVersion((v) => v + 1);
                }}
              >
                Redo reference
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}

      {debug && run && sr && (
        <EchoDebug
          run={run}
          sampleRate={sr}
          offsetCm={offsetCm}
          labels={labels}
          onSaved={setRecordingKey}
        />
      )}
    </div>
  );
}

function EchoDebug({
  run,
  sampleRate,
  offsetCm,
  labels,
  onSaved,
}: {
  run: { r: EchoRun; samples: Float32Array; emitIndex: number };
  sampleRate: number;
  offsetCm: number;
  labels: RecordingLabels;
  onSaved: (key: string) => void;
}) {
  const { r, samples, emitIndex } = run;
  const a = r.analysis;
  const spc = r.samplesPerCm;
  // Plot the envelopes against distance from the direct path, in cm.
  const x0 = -a.directPosition / spc;
  const toDb = (e: ArrayLike<number>) =>
    Float32Array.from(e, (v) => Math.max(-80, 20 * Math.log10(v || 1e-9)));
  const marks = a.candidates.slice(0, 4).map((k) => ({
    x: k.rawCm,
    label: `${(k.rawCm + offsetCm).toFixed(1)}`,
  }));
  return (
    <details className="debug" open>
      <summary>Debug: echo</summary>
      <h3>Recording</h3>
      <Waveform
        data={samples}
        sampleRate={sampleRate}
        markers={[
          { x: emitIndex / sampleRate, label: 'play' },
          { x: r.directAbs / sampleRate, label: 'direct' },
        ]}
      />
      <h3>Averaged matched filter, raw (dB re direct, x = cm)</h3>
      <LinePlot y={toDb(a.rawEnv)} x0={x0} dx={1 / spc} xUnit=" cm" markers={marks} height={90} />
      <h3>
        After removing the direct path ({a.usedReference ? 'free-air reference' : 'model only'})
      </h3>
      <LinePlot
        y={toDb(a.env)}
        x0={x0}
        dx={1 / spc}
        xUnit=" cm"
        markers={[
          { x: (a.searchFrom - a.directPosition) / spc, label: 'min' },
          { x: (a.searchTo - a.directPosition) / spc, label: 'max' },
          ...marks,
        ]}
        height={110}
      />
      <table className="numbers">
        <thead>
          <tr>
            <th>raw cm</th>
            <th>level dB</th>
            <th>SNR dB</th>
          </tr>
        </thead>
        <tbody>
          {a.candidates.map((k) => (
            <tr key={k.position} className={k === a.best ? 'chosen' : ''}>
              <td className="mono">{k.rawCm.toFixed(2)}</td>
              <td className="mono">{k.levelDb.toFixed(1)}</td>
              <td className="mono">{k.snrDb.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono small">
        c {r.speed.toFixed(1)} m/s · {spc.toFixed(3)} samples/cm · offset {offsetCm.toFixed(2)} cm ·
        spread ±{a.spreadCm.toFixed(2)} cm · floor {a.floorDb.toFixed(1)} dB · runner-up{' '}
        {Number.isFinite(a.runnerUpDb) ? a.runnerUpDb.toFixed(1) : '—'} dB · repeats {r.repeatsUsed}{' '}
        · confidence {(a.confidence * 100).toFixed(0)}% · sr {sampleRate}
      </p>
      <SaveRecording
        samples={samples}
        sampleRate={sampleRate}
        mode="echo"
        labels={{
          ...labels,
          emitIndex,
          rawCm: a.best ? +a.best.rawCm.toFixed(2) : 0,
          ...echoConfig(sampleRate),
        }}
        onSaved={onSaved}
      />
    </details>
  );
}

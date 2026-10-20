import { useEffect, useRef, useState } from 'react';
import { detectOnsets, type TapSummary } from '@senselab/dsp';
import type { RecordingLabels } from '@senselab/shared';
import { audio, concat } from '../audio/engine';
import { useDebug } from '../lib/debug';
import { runDsp } from '../workers/dsp-client';
import { HowTo } from './howto/HowTo';
import { TapBucketAnim } from './howto/animations';
import { LiveMic } from './LiveMic';
import { LinePlot, Waveform } from './plots';
import { SaveRecording } from './SaveRecording';

const MAX_S = 8;
const TARGET_TAPS = 5;

export interface TapCaptureResult {
  summary: TapSummary;
  samples: Float32Array;
  sampleRate: number;
  recordingKey: string | null;
}

type Analysis = Awaited<ReturnType<typeof runDspTaps>>;
const runDspTaps = (x: Float32Array, sr: number, band?: [number, number]) =>
  runDsp('analyzeTaps', x, sr, band);

/**
 * Records a few taps, finds each tap's pitch in the worker and summarises them.
 * The caller decides what the pitch means (a calibration point or a measurement).
 */
export function TapCapture({
  band,
  level = 0.4,
  actionLabel,
  labels,
  onResult,
}: {
  band?: [number, number];
  /** Fill level (0..1) to draw in the how-to animation. */
  level?: number;
  actionLabel: string;
  labels: RecordingLabels;
  onResult: (r: TapCaptureResult) => void;
}) {
  const debug = useDebug();
  const [phase, setPhase] = useState<'idle' | 'listening' | 'analysing' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [liveTaps, setLiveTaps] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(MAX_S);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [rec, setRec] = useState<{ samples: Float32Array; sampleRate: number } | null>(null);
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = async () => {
    setError(null);
    setAnalysis(null);
    setRecordingKey(null);
    let lease;
    try {
      lease = await audio.acquire();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const sr = lease.info.sampleRate;
    const chunks: Float32Array[] = [];
    setPhase('listening');
    setLiveTaps(0);
    setSecondsLeft(MAX_S);
    const t0 = performance.now();

    const finished = new Promise<void>((resolve) => {
      const off = audio.onChunk((c) => chunks.push(c));
      const timer = setInterval(() => {
        const elapsed = (performance.now() - t0) / 1000;
        setSecondsLeft(Math.max(0, Math.ceil(MAX_S - elapsed)));
        const n = detectOnsets(concat(chunks), sr).length;
        setLiveTaps(n);
        if (elapsed >= MAX_S || n >= TARGET_TAPS) stop();
      }, 400);
      const stop = () => {
        clearInterval(timer);
        off();
        stopRef.current = null;
        resolve();
      };
      stopRef.current = stop;
    });
    await finished;
    // Let the last tap ring out before analysing.
    const tail: Float32Array[] = [];
    await new Promise<void>((r) => {
      const off = audio.onChunk((c) => tail.push(c));
      setTimeout(() => (off(), r()), 250);
    });
    // Done with the mic: close it before the (slower) analysis.
    lease.release();
    const samples = concat([...chunks, ...tail]);
    setRec({ samples, sampleRate: sr });
    setPhase('analysing');
    try {
      const a = await runDspTaps(samples, sr, band);
      setAnalysis(a);
      setPhase('done');
      if (!a.summary) setError(noTapsMessage(a.onsetsS.length));
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const s = analysis?.summary;
  return (
    <div className="stack">
      {phase === 'idle' && (
        <HowTo
          compact
          steps={[
            {
              art: <TapBucketAnim level={level} />,
              title: 'Tap the side 4–5 times',
              text: 'Use a pen or spoon, at the same spot every time (a hand’s width below the rim). Phone about 20 cm away. Leave a second between taps.',
            },
          ]}
        />
      )}

      {phase === 'listening' && (
        <div className="card stack listening">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Listening… tap now</strong>
            <span className="mono">{secondsLeft}s</span>
          </div>
          <LiveMic />
          <div className="tap-dots" aria-label={`${liveTaps} taps heard`}>
            {Array.from({ length: TARGET_TAPS }, (_, i) => (
              <span key={i} className={i < liveTaps ? 'on' : ''} />
            ))}
          </div>
          <button onClick={() => stopRef.current?.()} disabled={liveTaps < 2}>
            Done
          </button>
        </div>
      )}

      {phase === 'analysing' && <p className="muted">Finding the pitch of each tap…</p>}

      {phase === 'done' && s && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              Pitch <strong className="mono">{s.frequency.toFixed(1)} Hz</strong>
            </span>
            <span className="muted small mono">
              ±{s.spreadHz.toFixed(1)} Hz · {s.used} taps
              {s.rejected ? ` (${s.rejected} ignored)` : ''}
            </span>
          </div>
          {s.spreadHz / s.frequency > 0.01 && (
            <p className="notice">
              Taps disagreed by more than 1%. Tap the same spot, just as firmly, and try again.
            </p>
          )}
          <button
            className="primary block"
            onClick={() => {
              if (!rec) return;
              onResult({ summary: s, ...rec, recordingKey });
              // Back to the start so the same reading can't be submitted twice.
              setPhase('idle');
            }}
          >
            {actionLabel}
          </button>
        </div>
      )}

      {(phase === 'idle' || phase === 'done') && (
        <button className={phase === 'idle' ? 'primary block' : 'block'} onClick={start}>
          {phase === 'idle' ? 'Start listening' : 'Tap again'}
        </button>
      )}
      {error && <p className="error">{error}</p>}

      {debug && rec && analysis && (
        <details className="debug" open>
          <summary>Debug: taps</summary>
          <h3>Recording with detected onsets</h3>
          <Waveform
            data={rec.samples}
            sampleRate={rec.sampleRate}
            markers={analysis.onsetsS.map((t, i) => ({ x: t, label: String(i + 1) }))}
          />
          {analysis.spectra.map((sp, i) => (
            <div key={i}>
              <h3>
                Tap {i + 1} spectrum (dB), peak {sp.peakHz.toFixed(1)} Hz
              </h3>
              <LinePlot
                y={sp.db}
                x0={sp.f0}
                dx={sp.dHz}
                xUnit=" Hz"
                markers={[{ x: sp.peakHz }]}
                height={90}
              />
            </div>
          ))}
          <table className="numbers">
            <thead>
              <tr>
                <th>t (s)</th>
                <th>f (Hz)</th>
                <th>SNR dB</th>
                <th>Q</th>
                <th>other peaks (Hz)</th>
              </tr>
            </thead>
            <tbody>
              {analysis.taps.map((t) => (
                <tr key={t.onsetS}>
                  <td className="mono">{t.onsetS.toFixed(3)}</td>
                  <td className="mono">{t.frequency.toFixed(1)}</td>
                  <td className="mono">{t.snrDb.toFixed(0)}</td>
                  <td className="mono">{t.q.toFixed(0)}</td>
                  <td className="mono">
                    {t.resonance.peaks
                      .slice(1)
                      .map((p) => p.frequency.toFixed(0))
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mono small">
            band {band ? `${band[0].toFixed(0)}–${band[1].toFixed(0)}` : '80–6000'} Hz · onsets{' '}
            {analysis.onsetsS.length} · sr {rec.sampleRate}
          </p>
          <SaveRecording
            samples={rec.samples}
            sampleRate={rec.sampleRate}
            mode="tap"
            labels={{ ...labels, pitchHz: s ? +s.frequency.toFixed(2) : 0 }}
            onSaved={setRecordingKey}
          />
        </details>
      )}
    </div>
  );
}

function noTapsMessage(onsets: number) {
  return onsets === 0
    ? 'No taps heard. Tap firmly with something hard, closer to the phone.'
    : 'Heard the taps but no clear ringing pitch. Try a harder tapper (metal spoon), or tap a spot that rings rather than thuds.';
}

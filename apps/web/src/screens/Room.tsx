import { useState } from 'react';
import { median, type RoomAnalysis } from '@senselab/dsp';
import { audio } from '../audio/engine';
import { HowTo } from '../components/howto/HowTo';
import { ClapAnim } from '../components/howto/animations';
import { LiveMic } from '../components/LiveMic';
import { LinePlot, Waveform } from '../components/plots';
import { SaveRecording } from '../components/SaveRecording';
import { useDebug } from '../lib/debug';
import { Link } from '../lib/router';
import { runDsp } from '../workers/dsp-client';

const RECORD_S = 4;

interface Run {
  analysis: RoomAnalysis;
  samples: Float32Array;
  sampleRate: number;
}

/** Plain-language reading of a mid-frequency RT60. */
function describe(rt: number) {
  if (rt < 0.3) return 'Very dry: like a car, a closet full of clothes, or a studio booth.';
  if (rt < 0.6) return 'Typical furnished room: living room, bedroom, small office.';
  if (rt < 1.0) return 'Lively: a kitchen, a bathroom, an empty room, a classroom.';
  if (rt < 2.0) return 'Reverberant: a hall, a gym, a big empty space.';
  return 'Very reverberant: a church, a stairwell, a tiled hall.';
}

const sec = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));

/** Room acoustics: reverberation time (RT60) from a clap. */
export function Room() {
  const debug = useDebug();
  const [phase, setPhase] = useState<'idle' | 'listening' | 'analysing'>('idle');
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  const listen = async () => {
    setError(null);
    try {
      const info = await audio.start();
      setPhase('listening');
      const samples = await audio.record(RECORD_S);
      setPhase('analysing');
      const analysis = await runDsp('analyzeRoom', samples, info.sampleRate);
      setPhase('idle');
      if (analysis.rt60 == null) {
        setError(
          analysis.onsetS == null
            ? 'No clap heard. Clap once, sharply, within the 4 seconds.'
            : 'Heard the clap, but the room was too noisy to follow the decay. Try a louder clap or a quieter moment.',
        );
        return;
      }
      setRuns((r) => [{ analysis, samples, sampleRate: info.sampleRate }, ...r].slice(0, 5));
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const rts = runs.map((r) => r.analysis.rt60!).filter((v) => v != null);
  const rt = rts.length ? median(rts) : null;
  const latest = runs[0];

  return (
    <section className="stack">
      <div>
        <h1>🏛️ Room acoustics</h1>
        <p className="muted">
          How long a sound lingers: the reverberation time, RT60, from one clap.
        </p>
      </div>
      <HowTo
        compact
        steps={[
          {
            art: <ClapAnim />,
            title: 'Clap once, sharply',
            text: 'Stand away from walls, phone at chest height in the other hand (or on a table). Quiet room. Then stay silent for 3 seconds.',
          },
        ]}
      />
      {phase === 'listening' && (
        <div className="card stack listening">
          <strong>Listening… clap now</strong>
          <LiveMic />
        </div>
      )}
      <button className="primary block" onClick={listen} disabled={phase !== 'idle'}>
        {phase === 'analysing'
          ? 'Following the decay…'
          : phase === 'listening'
            ? 'Listening…'
            : runs.length
              ? 'Clap again (averages up to 5)'
              : 'Start listening'}
      </button>
      {error && <p className="error">{error}</p>}

      {rt != null && latest && (
        <div className="card stack">
          <span className="big-number">RT60 ≈ {rt.toFixed(2)} s</span>
          <span className="muted small">
            500 Hz–2 kHz, median of {rts.length} clap{rts.length === 1 ? '' : 's'}
            {rts.length > 1 ? ` (${rts.map((v) => v.toFixed(2)).join(', ')})` : ''}
          </span>
          <p>{describe(rt)}</p>
          <table className="numbers">
            <thead>
              <tr>
                <th>Band</th>
                <th>T20 s</th>
                <th>T30 s</th>
                <th>EDT s</th>
                <th>range dB</th>
                <th>± </th>
              </tr>
            </thead>
            <tbody>
              {latest.analysis.bands.map((b) => (
                <tr key={b.fc}>
                  <td className="mono">{b.fc >= 1000 ? `${b.fc / 1000}k` : b.fc}</td>
                  <td className="mono">{sec(b.t20?.seconds)}</td>
                  <td className="mono">{sec(b.t30?.seconds)}</td>
                  <td className="mono">{sec(b.edt?.seconds)}</td>
                  <td className="mono">{b.dynamicRangeDb.toFixed(0)}</td>
                  <td className="mono">
                    {b.scatter != null ? `${(b.scatter * 100).toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Latest clap. T20 needs 35 dB of range above the room noise, T30 needs 45 dB; a dash
            means there wasn't enough. "±" is the expected scatter of a single clap in that band.
            Claps are weak below 500 Hz, and phone mics roll off there, so the 250 Hz band is the
            least reliable.
          </p>
        </div>
      )}

      {debug && latest && <RoomDebug run={latest} />}

      <Link href="/">← All modes</Link>
    </section>
  );
}

function RoomDebug({ run }: { run: Run }) {
  const a = run.analysis;
  const bb = a.broadband;
  return (
    <details className="debug" open>
      <summary>Debug: room</summary>
      <h3>Recording</h3>
      <Waveform
        data={run.samples}
        sampleRate={run.sampleRate}
        markers={a.onsetS != null ? [{ x: a.onsetS, label: 'clap' }] : []}
      />
      {bb && (
        <>
          <h3>Broadband Schroeder decay (dB, x = s)</h3>
          <LinePlot
            y={Float32Array.from(bb.curveDb, (v) => Math.max(-70, v))}
            dx={bb.curveStepS}
            xUnit=" s"
            markers={[{ x: bb.truncationS, label: 'noise' }]}
          />
        </>
      )}
      {a.bands.map((b) => (
        <div key={b.fc}>
          <h3>
            {b.fc} Hz decay · range {b.dynamicRangeDb.toFixed(0)} dB · T20 r²{' '}
            {b.t20 ? b.t20.r2.toFixed(3) : '—'}
          </h3>
          <LinePlot
            y={Float32Array.from(b.curveDb, (v) => Math.max(-70, v))}
            dx={b.curveStepS}
            xUnit=" s"
            markers={[{ x: b.truncationS, label: 'noise' }]}
            height={70}
          />
        </div>
      ))}
      <p className="mono small">
        broadband T20 {sec(bb?.t20?.seconds)} T30 {sec(bb?.t30?.seconds)} EDT{' '}
        {sec(bb?.edt?.seconds)} · noise {bb?.noiseDb.toFixed(1)} dB · sr {run.sampleRate}
      </p>
      <SaveRecording
        samples={run.samples}
        sampleRate={run.sampleRate}
        mode="room"
        labels={{ test: 'clap', rt60: a.rt60 != null ? +a.rt60.toFixed(3) : 0 }}
      />
    </details>
  );
}

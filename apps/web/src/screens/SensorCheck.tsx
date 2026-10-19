import { useEffect, useRef, useState } from 'react';
import { makeSweep, sweepOptions, type Spectrogram, type SweepAnalysis } from '@senselab/dsp';
import { audio, type MicInfo } from '../audio/engine';
import { CapabilityList } from '../components/CapabilityList';
import { HowTo } from '../components/howto/HowTo';
import { MicListenAnim, PhoneOnTableAnim, PhoneTiltAnim } from '../components/howto/animations';
import { LiveMic } from '../components/LiveMic';
import { BandChart, LinePlot, SpectrogramView, Waveform } from '../components/plots';
import { SaveRecording } from '../components/SaveRecording';
import {
  detectCapabilities,
  isIOS,
  requestMotionPermission,
  type Capability,
} from '../lib/capabilities';
import { useDebug } from '../lib/debug';
import { loadAudioProfile, saveAudioProfile, type AudioProfile } from '../lib/profile';
import { Link } from '../lib/router';
import { runDsp } from '../workers/dsp-client';

const SWEEP_S = 2.5;
const PAD_S = 0.3;

interface SweepRun {
  analysis: SweepAnalysis;
  recorded: Float32Array;
  noise: Float32Array;
  correlation: Float32Array;
  sampleRate: number;
  sg: Spectrogram | null;
}

export function SensorCheck() {
  const debug = useDebug();
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [mic, setMic] = useState<MicInfo | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [sweepState, setSweepState] = useState<
    'idle' | 'noise' | 'sweep' | 'analyse' | 'done' | 'error'
  >('idle');
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [run, setRun] = useState<SweepRun | null>(null);
  const [profile, setProfile] = useState<AudioProfile | null>(loadAudioProfile);

  useEffect(() => {
    detectCapabilities().then(setCaps);
  }, []);

  const startMic = async () => {
    setMicError(null);
    try {
      setMic(await audio.start());
    } catch (e) {
      setMicError(micErrorMessage(e));
    }
  };

  const runSweep = async () => {
    setSweepError(null);
    setRun(null);
    try {
      const info = mic ?? (await audio.start());
      setMic(info);
      const sr = info.sampleRate;
      setSweepState('noise');
      const noise = await audio.record(0.6);
      setSweepState('sweep');
      const emitted = makeSweep(sr, SWEEP_S);
      const recorded = await audio.playAndRecord(emitted, PAD_S);
      setSweepState('analyse');
      const { analysis, correlation } = await runDsp('analyzeSweep', {
        sweep: sweepOptions(sr, SWEEP_S),
        emitted,
        recorded,
        noise,
      });
      const sg = debug ? await runDsp('spectrogram', recorded, sr, 1024, 512) : null;
      setRun({ analysis, recorded, noise, correlation, sampleRate: sr, sg });
      setSweepState('done');
      if (analysis.heard) {
        const p: AudioProfile = {
          measuredAt: new Date().toISOString(),
          sampleRate: sr,
          latencyS: analysis.latencyS - PAD_S,
          usableMaxHz: analysis.usableMaxHz,
          chirp: analysis.recommended,
          bands: analysis.bands,
          userAgent: navigator.userAgent,
        };
        saveAudioProfile(p);
        setProfile(p);
      }
    } catch (e) {
      setSweepState('error');
      setSweepError(micErrorMessage(e));
    }
  };

  const busy = sweepState === 'noise' || sweepState === 'sweep' || sweepState === 'analyse';

  return (
    <section className="stack">
      <div>
        <h1>🎚️ Sensor check</h1>
        <p className="muted">
          Finds out what this phone can actually do. Measuring modes use the results.
        </p>
      </div>

      <div className="card stack">
        <h2>What this browser offers</h2>
        {caps ? <CapabilityList caps={caps} /> : <p className="muted">Checking…</p>}
      </div>

      <div className="card stack">
        <h2>Microphone</h2>
        <HowTo
          compact
          steps={[
            {
              art: <MicListenAnim />,
              title: 'Allow the microphone',
              text: 'Talk or clap. The bar should jump. Audio stays on your phone.',
            },
          ]}
        />
        {!mic ? (
          <button className="primary block" onClick={startMic}>
            Start microphone
          </button>
        ) : (
          <>
            <LiveMic />
            <dl className="kv">
              <dt>Sample rate</dt>
              <dd className="mono">{mic.sampleRate} Hz</dd>
              <dt>Echo cancel / noise suppr. / AGC</dt>
              <dd className="mono">
                {flag(mic.settings.echoCancellation)} / {flag(mic.settings.noiseSuppression)} /{' '}
                {flag(mic.settings.autoGainControl)}
              </dd>
              {debug && (
                <>
                  <dt>Input</dt>
                  <dd className="mono small">{mic.label || 'default'}</dd>
                  <dt>Base / output latency</dt>
                  <dd className="mono">
                    {(mic.baseLatencyS * 1000).toFixed(1)} /{' '}
                    {mic.outputLatencyS != null ? (mic.outputLatencyS * 1000).toFixed(1) : '—'} ms
                  </dd>
                </>
              )}
            </dl>
            {(mic.settings.echoCancellation || mic.settings.autoGainControl) && (
              <p className="notice">
                This browser kept some voice processing on despite our request. Tap and echo
                readings may be less stable.
              </p>
            )}
          </>
        )}
        {micError && <p className="error">{micError}</p>}
      </div>

      <div className="card stack">
        <h2>Speaker → microphone sweep</h2>
        <HowTo
          compact
          steps={[
            {
              art: <PhoneOnTableAnim />,
              title: 'Phone flat on a table, quiet room',
              text: `Volume about 70%${isIOS() ? ', ring/silent switch on ring' : ''}. You'll hear a ${SWEEP_S}-second rising whistle.`,
            },
          ]}
        />
        <button className="primary block" onClick={runSweep} disabled={busy}>
          {sweepState === 'noise'
            ? 'Listening to the room…'
            : sweepState === 'sweep'
              ? 'Sweeping…'
              : sweepState === 'analyse'
                ? 'Analysing…'
                : run
                  ? 'Run sweep again'
                  : 'Run sweep'}
        </button>
        {sweepError && <p className="error">{sweepError}</p>}
        {run && <SweepResult run={run} />}
        {!run && profile && (
          <p className="muted small">
            Last result ({new Date(profile.measuredAt).toLocaleString()}):{' '}
            {profile.chirp
              ? `${profile.chirp.kind} chirps ${(profile.chirp.f0 / 1000).toFixed(0)}–${(profile.chirp.f1 / 1000).toFixed(0)} kHz`
              : 'no usable chirp band'}
          </p>
        )}
        {run && debug && <SweepDebug run={run} />}
      </div>

      <MotionCard />
      <MagnetometerCard />

      <Link href="/">← All modes</Link>
    </section>
  );
}

function SweepResult({ run }: { run: SweepRun }) {
  const a = run.analysis;
  if (!a.heard) {
    return (
      <p className="notice">
        ⛔ The microphone didn't hear the speaker. Turn the volume up
        {isIOS() ? ', make sure the ring/silent switch is on ring,' : ''} and try again.
      </p>
    );
  }
  const c = a.recommended;
  return (
    <div className="stack">
      <BandChart bands={a.bands} highlight={c} />
      {c?.kind === 'ultrasonic' && (
        <p className="ok-note">
          ✅ Near-ultrasonic works: {(c.f0 / 1000).toFixed(0)}–{(c.f1 / 1000).toFixed(0)} kHz. Echo
          ranging will use quiet high-pitched chirps.
        </p>
      )}
      {c?.kind === 'audible' && (
        <p className="notice">
          ⚠️ This phone can't reliably emit or hear above 16 kHz. Echo ranging will use audible
          chirps at {(c.f0 / 1000).toFixed(0)}–{(c.f1 / 1000).toFixed(0)} kHz, so you'll hear short
          clicks.
        </p>
      )}
      {!c && (
        <p className="notice">
          ⚠️ The sweep was heard, but no band was clean enough for echo ranging. Try a quieter room
          or higher volume. Tap mode doesn't need this.
        </p>
      )}
      <p className="muted small">
        Usable up to {(a.usableMaxHz / 1000).toFixed(1)} kHz · match score {a.matchScore.toFixed(2)}
      </p>
    </div>
  );
}

function SweepDebug({ run }: { run: SweepRun }) {
  const a = run.analysis;
  return (
    <details className="debug" open>
      <summary>Debug: sweep</summary>
      <h3>Recording (noise | sweep)</h3>
      <Waveform
        data={run.recorded}
        sampleRate={run.sampleRate}
        markers={[{ x: a.latencyS, label: 'sweep start' }]}
      />
      {run.sg && (
        <>
          <h3>Spectrogram</h3>
          <SpectrogramView sg={run.sg} maxHz={run.sampleRate / 2} />
        </>
      )}
      <h3>Matched-filter envelope (lag)</h3>
      <LinePlot
        y={run.correlation}
        dx={1000 / run.sampleRate}
        xUnit=" ms"
        markers={[{ x: a.latencyS * 1000, label: `${(a.latencyS * 1000).toFixed(1)} ms` }]}
      />
      <table className="numbers">
        <thead>
          <tr>
            <th>Band (Hz)</th>
            <th>SNR dB</th>
            <th>Resp. dB</th>
          </tr>
        </thead>
        <tbody>
          {a.bands.map((b) => (
            <tr key={b.fLo}>
              <td className="mono">
                {b.fLo}–{b.fHi}
              </td>
              <td className="mono">{db(b.snrDb)}</td>
              <td className="mono">{db(b.responseDb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono small">
        latency (incl. {PAD_S * 1000} ms pad) {(a.latencyS * 1000).toFixed(1)} ms · score{' '}
        {a.matchScore.toFixed(3)} · sr {run.sampleRate}
      </p>
      <SaveRecording
        samples={run.recorded}
        sampleRate={run.sampleRate}
        mode="sensor-check"
        labels={{
          test: 'sweep',
          sweepS: SWEEP_S,
          padS: PAD_S,
          f1: sweepOptions(run.sampleRate).f1,
        }}
      />
    </details>
  );
}

function MotionCard() {
  const [state, setState] = useState<'idle' | 'on' | 'denied' | 'unsupported'>(
    'DeviceMotionEvent' in window ? 'idle' : 'unsupported',
  );
  const [reading, setReading] = useState<{
    x: number;
    y: number;
    z: number;
    rot: number;
    hz: number;
  } | null>(null);
  const count = useRef({ n: 0, t0: 0 });

  useEffect(() => {
    if (state !== 'on') return;
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const c = count.current;
      if (!c.t0) c.t0 = performance.now();
      c.n++;
      const now = performance.now();
      if (now - last < 100) return;
      last = now;
      const g = e.accelerationIncludingGravity;
      const r = e.rotationRate;
      setReading({
        x: g?.x ?? 0,
        y: g?.y ?? 0,
        z: g?.z ?? 0,
        rot: Math.hypot(r?.alpha ?? 0, r?.beta ?? 0, r?.gamma ?? 0),
        hz: (c.n / (now - c.t0)) * 1000,
      });
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [state]);

  const start = async () => setState((await requestMotionPermission()) ? 'on' : 'denied');

  return (
    <div className="card stack">
      <h2>Motion sensors</h2>
      {state === 'unsupported' && <p className="notice">Not supported on this device.</p>}
      {state === 'idle' && (
        <>
          <HowTo
            compact
            steps={[
              {
                art: <PhoneTiltAnim />,
                title: 'Tilt the phone',
                text: 'The numbers should follow.',
              },
            ]}
          />
          <button className="block" onClick={start}>
            Start motion sensors
          </button>
        </>
      )}
      {state === 'denied' && (
        <p className="error">
          Motion access was denied. On iPhone, reload and allow it when asked.
        </p>
      )}
      {state === 'on' &&
        (reading ? (
          <dl className="kv">
            <dt>Accel incl. gravity (m/s²)</dt>
            <dd className="mono">
              {reading.x.toFixed(2)}, {reading.y.toFixed(2)}, {reading.z.toFixed(2)}
            </dd>
            <dt>Rotation rate (°/s)</dt>
            <dd className="mono">{reading.rot.toFixed(1)}</dd>
            <dt>Event rate</dt>
            <dd className="mono">{reading.hz.toFixed(0)} Hz</dd>
          </dl>
        ) : (
          <p className="muted">Waiting for the first reading… move the phone.</p>
        ))}
    </div>
  );
}

interface MagnetometerLike extends EventTarget {
  x?: number;
  y?: number;
  z?: number;
  start(): void;
  stop(): void;
}

function MagnetometerCard() {
  const supported = 'Magnetometer' in window;
  const [field, setField] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensor = useRef<MagnetometerLike | null>(null);
  useEffect(() => () => sensor.current?.stop(), []);

  const start = () => {
    try {
      const Ctor = (
        window as unknown as { Magnetometer: new (o: { frequency: number }) => MagnetometerLike }
      ).Magnetometer;
      const s = new Ctor({ frequency: 10 });
      s.addEventListener('reading', () => setField(Math.hypot(s.x ?? 0, s.y ?? 0, s.z ?? 0)));
      s.addEventListener('error', (e) =>
        setError((e as Event & { error?: Error }).error?.message ?? 'Sensor error'),
      );
      s.start();
      sensor.current = s;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card stack">
      <h2>Magnetometer</h2>
      {!supported ? (
        <p className="notice">
          Not supported on this device.{' '}
          {isIOS()
            ? 'iOS Safari does not expose the magnetometer.'
            : 'Only Android Chrome exposes it.'}{' '}
          The metal finder needs this.
        </p>
      ) : field == null ? (
        <button className="block" onClick={start}>
          Start magnetometer
        </button>
      ) : (
        <p className="mono">|B| = {field.toFixed(1)} µT (Earth is about 25–65 µT)</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const flag = (v: boolean | string | undefined) =>
  v === undefined ? '?' : typeof v === 'string' ? v : v ? 'on' : 'off';

/** Bands with literally zero recorded power (digital silence) read as −200 dB; show a dash. */
const db = (v: number) => (v < -150 ? '—' : v.toFixed(1));

function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError')
    return 'Microphone permission was denied. Allow it in your browser settings and try again.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is busy in another app.';
  return e instanceof Error ? e.message : String(e);
}

import { useEffect, useRef, useState } from 'react';
import {
  calibrateCompass,
  compassAnomaly,
  detectAnomaly,
  fieldBaseline,
  fieldMagnitude,
  type CompassCalibration,
  type CompassSample,
} from '@senselab/dsp';
import { HowTo } from '../components/howto/HowTo';
import { MetalSweepAnim } from '../components/howto/animations';
import { LinePlot } from '../components/plots';
import { api } from '../lib/api';
import { isIOS } from '../lib/capabilities';
import { useDebug } from '../lib/debug';
import { Link } from '../lib/router';

/**
 * Metal finder: the magnetometer's field magnitude where the browser exposes it (Android
 * Chrome with the Generic Sensor extra-classes flag), otherwise compass deflection that
 * the gyroscope can't explain (works on iPhone and stock Android Chrome).
 */

type Source = 'field' | 'compass';
type Phase = 'idle' | 'calibrating' | 'live' | 'error';

interface MagnetometerLike extends EventTarget {
  x?: number;
  y?: number;
  z?: number;
  start(): void;
  stop(): void;
}

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};
type MotionCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> };

const CAL_S = 4;
const WINDOW_S = 12;

async function askPermissions(): Promise<boolean> {
  const O = window.DeviceOrientationEvent as OrientationCtor | undefined;
  const M = window.DeviceMotionEvent as MotionCtor | undefined;
  try {
    if (typeof O?.requestPermission === 'function' && (await O.requestPermission()) !== 'granted')
      return false;
    if (typeof M?.requestPermission === 'function' && (await M.requestPermission()) !== 'granted')
      return false;
    return true;
  } catch {
    return false;
  }
}

/** Heading in degrees from whichever absolute orientation the browser offers. */
function headingOf(e: DeviceOrientationEvent): number | null {
  const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading;
  if (typeof ios === 'number') return ios;
  if (e.absolute && typeof e.alpha === 'number') return 360 - e.alpha;
  return null;
}

interface SensorHandlers {
  calibrated: (
    c: (CompassCalibration & { axis: string }) | { mean: number; noise: number },
  ) => void;
  reading: (value: number, unit: string, noise: number, series: number[]) => void;
  failed: (message: string) => void;
}

/** Raw field magnitude via the Generic Sensor Magnetometer; null if unavailable. */
function startFieldSensor(h: SensorHandlers, fallback: () => void): { stop: () => void } | null {
  if (!('Magnetometer' in window)) return null;
  try {
    const Ctor = (
      window as unknown as { Magnetometer: new (o: { frequency: number }) => MagnetometerLike }
    ).Magnetometer;
    const s = new Ctor({ frequency: 30 });
    const mags: number[] = [];
    let base: { mean: number; noise: number } | null = null;
    const t0 = performance.now();
    s.addEventListener('reading', () => {
      mags.push(fieldMagnitude(s.x ?? 0, s.y ?? 0, s.z ?? 0));
      if (!base) {
        if ((performance.now() - t0) / 1000 < CAL_S) return;
        base = fieldBaseline(mags.slice(-CAL_S * 30));
        h.calibrated(base);
        mags.length = 0;
        return;
      }
      const b = base;
      const series = mags.slice(-WINDOW_S * 30).map((v) => v - b.mean);
      h.reading(series[series.length - 1], 'µT', b.noise, series);
    });
    s.addEventListener('error', (e) => {
      // Present but blocked (flag, permission, no sensor): fall back to compass − gyro.
      if (!mags.length) {
        s.stop();
        fallback();
        return;
      }
      h.failed((e as Event & { error?: Error }).error?.message ?? 'Magnetometer error');
    });
    s.start();
    return { stop: () => s.stop() };
  } catch {
    return null;
  }
}

/** Compass deflection the gyroscope can't explain. */
function startCompassSensor(h: SensorHandlers): { stop: () => void; rezero: () => void } {
  const t0 = performance.now();
  const rates = { alpha: 0, beta: 0, gamma: 0 };
  const samples: { t: number; heading: number; rates: typeof rates }[] = [];
  let calib: (CompassCalibration & { axis: keyof typeof rates }) | null = null;
  let liveStart = 0;
  const onMotion = (e: DeviceMotionEvent) => {
    const r = e.rotationRate;
    rates.alpha = r?.alpha ?? 0;
    rates.beta = r?.beta ?? 0;
    rates.gamma = r?.gamma ?? 0;
  };
  const asCompass = (from: number, axis: keyof typeof rates): CompassSample[] =>
    samples.slice(from).map((s) => ({ t: s.t, heading: s.heading, yawRate: s.rates[axis] }));
  const onOrient = (e: DeviceOrientationEvent) => {
    const heading = headingOf(e);
    if (heading == null) return;
    const t = (performance.now() - t0) / 1000;
    samples.push({ t, heading, rates: { ...rates } });
    if (!calib) {
      if (t < CAL_S) return;
      // Browsers disagree on which rotationRate field is the screen-normal axis: try all
      // three and keep the one that explains the heading best.
      const fits = (['alpha', 'beta', 'gamma'] as const).map((axis) => ({
        axis,
        ...calibrateCompass(asCompass(0, axis)),
      }));
      calib = fits.sort((a, b) => a.noiseDeg - b.noiseDeg)[0];
      h.calibrated(calib);
      liveStart = samples.length;
      return;
    }
    // Live: a sliding window since the last re-zero (at most WINDOW_S long).
    while (samples.length - liveStart > WINDOW_S * 60) liveStart++;
    const a = compassAnomaly(asCompass(liveStart, calib.axis), calib.k);
    h.reading(a[a.length - 1], '°', calib.noiseDeg, a);
  };
  const evName =
    'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener('devicemotion', onMotion);
  window.addEventListener(evName, onOrient as EventListener);
  const check = setTimeout(() => {
    if (!samples.length) {
      h.failed(
        'No compass readings arrived. This browser may not offer an absolute compass; on iPhone, allow motion & orientation access.',
      );
    }
  }, 2500);
  return {
    stop: () => {
      clearTimeout(check);
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener(evName, onOrient as EventListener);
    },
    rezero: () => {
      liveStart = samples.length;
    },
  };
}

export function Metal() {
  const debug = useDebug();
  const [phase, setPhase] = useState<Phase>('idle');
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<{
    value: number;
    unit: string;
    level: number;
    detected: boolean;
    sigmas: number;
  } | null>(null);
  const [trace, setTrace] = useState<Float32Array>(new Float32Array());
  const [cal, setCal] = useState<
    (CompassCalibration & { axis: string }) | { mean: number; noise: number } | null
  >(null);
  const [beep, setBeep] = useState(false);
  const stopAll = useRef<(() => void) | null>(null);
  const beepRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);
  const levelRef = useRef(0);

  useEffect(() => () => stopAll.current?.(), []);

  // Optional beep: speaker only, pitch and loudness follow the meter.
  useEffect(() => {
    if (!beep) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    beepRef.current = { ctx, osc, gain };
    const id = setInterval(() => {
      const l = levelRef.current;
      osc.frequency.setTargetAtTime(300 + 1500 * l, ctx.currentTime, 0.05);
      gain.gain.setTargetAtTime(l > 0.05 ? 0.15 : 0, ctx.currentTime, 0.05);
    }, 80);
    return () => {
      clearInterval(id);
      osc.stop();
      void ctx.close();
      beepRef.current = null;
    };
  }, [beep]);

  const show = (value: number, unit: string, noise: number, series: number[]) => {
    const d = detectAnomaly(value, noise);
    levelRef.current = d.level;
    setReading({ value, unit, ...d });
    setTrace(Float32Array.from(series.slice(-360)));
  };

  const rezero = useRef<(() => void) | null>(null);

  const start = async () => {
    setError(null);
    setReading(null);
    stopAll.current?.();
    if (!(await askPermissions())) {
      setError(
        'Motion & orientation access was denied. Reload and allow it to use the metal finder.',
      );
      setPhase('error');
      return;
    }
    setPhase('calibrating');
    const handlers: SensorHandlers = {
      calibrated: (c) => {
        setCal(c);
        setPhase('live');
      },
      reading: show,
      failed: (msg) => {
        setError(msg);
        setPhase('error');
      },
    };
    const compass = () => {
      const run = startCompassSensor(handlers);
      setSource('compass');
      stopAll.current = run.stop;
      rezero.current = run.rezero;
    };
    const field = startFieldSensor(handlers, compass);
    if (field) {
      setSource('field');
      stopAll.current = field.stop;
    } else compass();
  };
  const stop = () => {
    stopAll.current?.();
    stopAll.current = null;
    setBeep(false);
    setPhase('idle');
  };

  return (
    <section className="stack">
      <div>
        <h1>🧲 Metal finder</h1>
        <p className="muted">
          Finds iron and steel (screws, nails, pipes, rebar) by how they bend the Earth's magnetic
          field. Aluminium, copper and gold don't show up.
        </p>
      </div>
      <HowTo
        compact
        steps={[
          {
            art: <MetalSweepAnim />,
            title: 'Calibrate away from metal, then sweep slowly',
            text: `Hold the phone flat. For the first ${CAL_S} s turn it gently left and right, away from anything metal. Then move it slowly, a few cm above the surface. The sensor is usually near the top of the phone.`,
          },
        ]}
      />
      {phase === 'idle' || phase === 'error' ? (
        <button className="primary block" onClick={start}>
          Start
        </button>
      ) : (
        <div className="row">
          <button className="block" onClick={stop}>
            Stop
          </button>
          {phase === 'live' && source === 'compass' && (
            <button className="block" onClick={() => rezero.current?.()}>
              Re-zero
            </button>
          )}
        </div>
      )}
      {phase === 'calibrating' && (
        <p className="notice">Calibrating… turn the phone gently left and right.</p>
      )}
      {error && <p className="error">{error}</p>}

      {phase === 'live' && reading && (
        <div className="card stack">
          <div
            className="meter"
            role="meter"
            aria-valuenow={Math.round(reading.level * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`meter-fill ${reading.detected ? 'hot' : ''}`}
              style={{ width: `${reading.level * 100}%` }}
            />
            <span className="meter-label mono">
              {reading.value >= 0 ? '+' : ''}
              {reading.value.toFixed(1)} {reading.unit}
            </span>
          </div>
          <span className="big-number">{reading.detected ? 'Metal!' : 'Nothing'}</span>
          <span className="muted small">
            {source === 'field'
              ? 'Field strength change (magnetometer).'
              : 'Compass deflection not explained by turning (compass − gyro). Re-zero between sweeps.'}
          </span>
          <LinePlot y={trace} height={80} />
          <label className="inline small">
            <input
              type="checkbox"
              checked={beep}
              style={{ width: 'auto', minHeight: 0 }}
              onChange={(e) => setBeep(e.target.checked)}
            />
            Beep (pitch rises near metal)
          </label>
        </div>
      )}

      {source === 'compass' && (
        <p className="muted small">
          Using the compass + gyro method
          {isIOS()
            ? ' (iOS has no raw magnetometer)'
            : " (this browser doesn't expose the raw magnetometer)"}
          . It's weaker and slower than the raw field, because phones smooth the compass with the
          gyro.
          {!isIOS() &&
            ' On Android Chrome, enabling chrome://flags/#enable-generic-sensor-extra-classes gives the direct field method.'}
        </p>
      )}

      {debug && cal && (
        <details className="debug" open>
          <summary>Debug: metal</summary>
          <pre className="mono small">
            {JSON.stringify(
              { source, cal, reading },
              (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v),
              1,
            )}
          </pre>
          <SaveTrace trace={trace} source={source} />
        </details>
      )}
      <Link href="/">← All modes</Link>
    </section>
  );
}

/** Debug: upload the last trace (JSON) as a regression fixture. */
function SaveTrace({ trace, source }: { trace: Float32Array; source: Source | null }) {
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="row small">
      <button
        className="small"
        onClick={async () => {
          setState('Uploading…');
          try {
            const blob = new Blob([JSON.stringify({ source, trace: Array.from(trace) })], {
              type: 'application/octet-stream',
            });
            const r = await api.uploadRecording(blob, {
              mode: 'other',
              labels: { mode: 'metal', source: source ?? '?' },
            });
            setState(`Saved ${r.key}`);
          } catch (e) {
            setState(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Save trace to cloud
      </button>
      {state && <span className="muted mono">{state}</span>}
    </div>
  );
}

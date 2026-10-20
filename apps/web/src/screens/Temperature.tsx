import { useState } from 'react';
import { speedOfSound, temperatureFromBaseline } from '@senselab/dsp';
import { EchoCapture } from '../components/EchoCapture';
import { PhoneAtWallAnim, TapeBaselineAnim } from '../components/howto/animations';
import { saveAirTemp } from '../lib/echo';
import { Link } from '../lib/router';

/** Raw distances in this mode are computed at an assumed 20 °C; the baseline corrects them. */
const ASSUMED_C = 20;

/** Experimental: air temperature from the speed of sound over a measured baseline. */
export function Temperature() {
  const [baseline, setBaseline] = useState('100');
  const [a, setA] = useState<{ raw: number; spread: number } | null>(null);
  const [b, setB] = useState<{ raw: number; spread: number } | null>(null);
  const L = parseFloat(baseline.replace(',', '.'));
  const t =
    a && b && L > 0
      ? temperatureFromBaseline(a.raw, b.raw, L, {
          assumedSpeed: speedOfSound(ASSUMED_C),
          sigmaRawCm: Math.hypot(Math.max(a.spread, b.spread), 0.1),
        })
      : null;
  const plausible = t && t.tempC > -30 && t.tempC < 60;

  const capture = (label: string, set: (v: { raw: number; spread: number }) => void) => (
    <EchoCapture
      steps={[
        {
          art: <PhoneAtWallAnim />,
          title: `${label}: bottom edge at the mark`,
          text: 'Point straight at the wall, keep still while it pings.',
        },
      ]}
      minCm={10}
      maxCm={140}
      fixedTempC={ASSUMED_C}
      labels={{ purpose: 'air-temperature', position: label }}
      renderResult={(r) =>
        r.best ? <span className="mono">raw {r.best.rawCm.toFixed(2)} cm</span> : null
      }
      onMeasured={(r) => r.best && set({ raw: r.best.rawCm, spread: r.spreadCm })}
    />
  );

  return (
    <section className="stack">
      <div>
        <h1>🌡️ Air temperature</h1>
        <p className="muted">
          <span className="pill medium">experimental</span> Sound travels faster in warm air (0.6
          m/s per °C). Ping a wall from two spots a known distance apart and the phone works out the
          speed of sound, and from it the temperature.
        </p>
      </div>
      <div className="card stack">
        <TapeBaselineAnim />
        <label>
          Distance between the two spots (cm)
          <input
            inputMode="decimal"
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
          />
          <span className="muted small">
            Lay a tape measure on the floor, straight out from the wall. 1 m gives about ±2 °C;
            shorter is worse.
          </span>
        </label>
      </div>
      <div className="card stack">
        <h2>1. Near spot</h2>
        {capture('Near spot', setA)}
        {a && <p className="ok-note">Near: {a.raw.toFixed(2)} cm</p>}
      </div>
      <div className="card stack">
        <h2>2. Far spot ({L > 0 ? L : '?'} cm further back)</h2>
        {capture('Far spot', setB)}
        {b && <p className="ok-note">Far: {b.raw.toFixed(2)} cm</p>}
      </div>
      {t && (
        <div className="card stack">
          <span className="big-number">
            {plausible ? `${t.tempC.toFixed(1)} °C` : 'Out of range'}
          </span>
          <span className="muted mono small">
            ± {t.sigmaC.toFixed(1)} °C · speed of sound {t.speed.toFixed(1)} m/s
          </span>
          {plausible ? (
            <button className="block" onClick={() => saveAirTemp(+t.tempC.toFixed(1))}>
              Use {t.tempC.toFixed(1)} °C for echo measurements
            </button>
          ) : (
            <p className="notice small">
              That would be {t.tempC.toFixed(0)} °C, so a reading is off. Check the two spots are
              exactly {L} cm apart along the same line and the phone points straight at the wall,
              then ping again.
            </p>
          )}
        </div>
      )}
      <p className="muted small">
        Uses the difference of the two readings, so the phone's own speaker/mic offset cancels.
        What's left is how exactly you place the phone (±3 mm ≈ ±2 °C over 1 m).
      </p>
      <Link href="/">← All modes</Link>
    </section>
  );
}

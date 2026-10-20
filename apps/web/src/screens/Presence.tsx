import { useEffect, useRef, useState } from 'react';
import { chirp, meanProfile, motionIndex, speedOfSound, type Breathing } from '@senselab/dsp';
import { audio } from '../audio/engine';
import { HowTo } from '../components/howto/HowTo';
import { PresenceAnim } from '../components/howto/animations';
import { LinePlot } from '../components/plots';
import { useDebug } from '../lib/debug';
import { echoBand } from '../lib/echo';
import { Link } from '../lib/router';
import { runDsp } from '../workers/dsp-client';

/** Pings every 50 ms (20 Hz), a 5 ms chirp each, range window 2 m. */
const PERIOD_S = 0.05;
const CHIRP_S = 0.005;
const RANGE_CM = 200;
const BREATH_WINDOW_S = 30;
/** Background (static scene) = mean of the last 4 s of profiles. */
const BG_S = 4;
/** Motion index above this is "moving" (the still-room level is ~1e-4). */
const MOVING = 0.003;

interface Live {
  /** Median motion index over the last second. */
  motion: number;
  resyncs: number;
  movingCm: number | null;
  breathing: Breathing | null;
  breathingCm: number | null;
  seconds: number;
}

export function Presence() {
  const debug = useDebug();
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [trace, setTrace] = useState<Float32Array>(new Float32Array());
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const start = async () => {
    setError(null);
    setLive(null);
    let lease;
    try {
      lease = await audio.acquire();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const sr = lease.info.sampleRate;
    const { band } = echoBand(sr);
    const ctx = audio.ctx!;
    const period = Math.round(PERIOD_S * sr);
    const template = chirp({
      f0: band.f0,
      f1: band.f1,
      durationS: CHIRP_S,
      sampleRate: sr,
      fadeS: 0.001,
      amplitude: 0.8,
    });
    const one = new Float32Array(period);
    one.set(template);
    const pre = Math.round(0.001 * sr);
    const c = speedOfSound(20);
    const samplesPerCm = (2 * sr) / (100 * c);
    const bins = pre + Math.round(RANGE_CM * samplesPerCm);
    const binOf = (cm: number) => pre + Math.round(cm * samplesPerCm);

    // Recent audio, stamped with AudioContext frames.
    const chunks: { frame: number; c: Float32Array }[] = [];
    const off = audio.onChunk((ch, frame) => {
      chunks.push({ frame, c: ch });
      while (chunks.length && chunks[0].frame < frame - 4 * sr) chunks.shift();
    });
    const slice = (from: number, to: number) => {
      const out = new Float32Array(Math.max(0, to - from));
      for (const { frame, c: ch } of chunks) {
        const a = Math.max(from, frame);
        const b = Math.min(to, frame + ch.length);
        for (let f = a; f < b; f++) out[f - from] = ch[f - frame];
      }
      return out;
    };
    const latest = () =>
      chunks.length ? chunks[chunks.length - 1].frame + chunks[chunks.length - 1].c.length : 0;

    const when = ctx.currentTime + 0.2;
    let emitFrame = Math.round(when * sr);
    let resyncs = 0;
    const stopLoop = audio.playLoop(one, when);
    let direct = -1;
    let nextPing = 0;
    const frames: Float32Array[] = [];
    const motions: number[] = [];
    let busy = false;
    let lastBreath = 0;
    let breathing: Breathing | null = null;

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const end = latest();
        if (direct < 0) {
          if (end < emitFrame + 0.6 * sr) return;
          // (After a re-sync, emitFrame is "now": the loop is still playing, any ping will do.)
          const at = await runDsp(
            'presenceAlign',
            slice(emitFrame, emitFrame + Math.round(0.4 * sr)),
            template,
          );
          if (at < 0)
            throw new Error('Could not hear the pings. Turn the volume up and try again.');
          direct = emitFrame + at;
          return;
        }
        // Every whole ping recorded since last time.
        const last = Math.floor((end - direct - bins - template.length) / period);
        if (last < nextPing) return;
        const from = direct + nextPing * period - pre;
        const x = slice(from, direct + last * period + bins + template.length);
        const { frames: fr, directBins } = await runDsp(
          'presenceFrames',
          x,
          template,
          pre,
          period,
          bins,
          pre,
        );
        // A dropped or repeated audio block shifts every later ping: re-align and start over.
        if (directBins.some((b) => Math.abs(b - pre) > 2)) {
          direct = -1;
          resyncs++;
          frames.length = 0;
          motions.length = 0;
          breathing = null;
          nextPing = 0;
          emitFrame = latest();
          return;
        }
        nextPing += fr.length;
        frames.push(...fr);
        const keep = Math.round(BREATH_WINDOW_S / PERIOD_S);
        if (frames.length > keep) frames.splice(0, frames.length - keep);

        const bg = meanProfile(frames.slice(-Math.round(BG_S / PERIOD_S)));
        const latestFrame = frames[frames.length - 1];
        const m = motionIndex(latestFrame, bg, binOf(20), binOf(RANGE_CM));
        motions.push(m);
        if (motions.length > 200) motions.shift();
        // Where the change is biggest.
        let peak = 0;
        let peakBin = -1;
        for (let i = binOf(20); i < bins; i++) {
          const d =
            (latestFrame[2 * i] - bg[2 * i]) ** 2 + (latestFrame[2 * i + 1] - bg[2 * i + 1]) ** 2;
          if (d > peak) [peak, peakBin] = [d, i];
        }
        // Breathing every 2 s, once 20 s of profiles exist.
        const now = performance.now();
        if (frames.length * PERIOD_S >= 20 && now - lastBreath > 2000) {
          lastBreath = now;
          breathing = await runDsp(
            'breathing',
            frames,
            1 / PERIOD_S,
            binOf(25),
            binOf(RANGE_CM - 20),
          );
        }
        const recent = motions.slice(-20).sort((a, b) => a - b);
        setLive({
          motion: recent[recent.length >> 1],
          resyncs,
          movingCm: m > MOVING && peakBin >= 0 ? (peakBin - pre) / samplesPerCm : null,
          breathing,
          breathingCm: breathing ? (breathing.bin - pre) / samplesPerCm : null,
          seconds: frames.length * PERIOD_S,
        });
        setTrace(Float32Array.from(motions, (v) => Math.log10(v + 1e-6)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        stopRef.current?.();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 500);
    stopRef.current = () => {
      clearInterval(timer);
      stopLoop();
      off();
      lease.release();
      stopRef.current = null;
      setRunning(false);
    };
    setRunning(true);
  };

  const sr = audio.info?.sampleRate ?? 48000;
  const ultrasonic = echoBand(sr).band.kind === 'ultrasonic';
  // A clear periodic rhythm means a still, breathing person (breathing itself registers as
  // a little motion); "movement" is change without such a rhythm.
  const breathOk = !!live?.breathing && live.breathing.snrDb >= 10;
  const moving = !!live && live.motion > MOVING && !breathOk;

  return (
    <section className="stack">
      <div>
        <h1>🫁 Presence</h1>
        <p className="muted">
          Near-ultrasonic sonar: tells if something is moving near the phone, and can pick up the
          rhythm of someone breathing when they're still, within about 2 m.
        </p>
      </div>
      {!ultrasonic && (
        <p className="notice small">
          This phone hasn't shown near-ultrasonic support (run the{' '}
          <Link href="/sensor-check">sensor check</Link>). Presence would use audible clicks, 20 per
          second, which is annoying and less precise.
        </p>
      )}
      <HowTo
        compact
        steps={[
          {
            art: <PresenceAnim />,
            title: 'Phone still, pointing at the person',
            text: 'On a table or bedside, bottom edge (speaker and mic) towards them, 0.5–1.5 m away. Breathing needs ~20 s of stillness to show.',
          },
        ]}
      />
      {running ? (
        <button className="block" onClick={() => stopRef.current?.()}>
          Stop
        </button>
      ) : (
        <button className="primary block" onClick={start}>
          Start sonar
        </button>
      )}
      {error && <p className="error">{error}</p>}

      {running && live && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="big-number">
              {moving ? 'Movement' : breathOk ? 'Someone still' : 'Still'}
            </span>
            <span className="pill high">mic + speaker on</span>
          </div>
          {live.movingCm != null && (
            <span className="muted small">change strongest at ≈ {live.movingCm.toFixed(0)} cm</span>
          )}
          <LinePlot y={trace} height={70} />
          <span className="muted small">motion index (log), last 10 s</span>
          <div className="stack" style={{ gap: 2 }}>
            <strong>
              Breathing:{' '}
              {breathOk
                ? `≈ ${live.breathing!.bpm.toFixed(0)} per minute`
                : live.seconds < 20
                  ? `listening… (${Math.max(0, 20 - live.seconds).toFixed(0)} s)`
                  : moving
                    ? 'not while there is movement'
                    : 'no clear rhythm'}
            </strong>
            {breathOk && (
              <span className="muted small">
                at ≈ {live.breathingCm!.toFixed(0)} cm · rhythm {live.breathing!.snrDb.toFixed(0)}{' '}
                dB above noise
              </span>
            )}
          </div>
        </div>
      )}
      <p className="muted small">
        Not a medical device. Fans, curtains and pets move too; a rhythm needs the person and the
        phone to stay still.
      </p>
      {debug && live && (
        <details className="debug" open>
          <summary>Debug: presence</summary>
          <pre className="mono small">
            {JSON.stringify(
              live,
              (_, v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v),
              1,
            )}
          </pre>
          <p className="mono small">
            {PERIOD_S * 1000} ms period · {CHIRP_S * 1000} ms chirp · range {RANGE_CM} cm · moving
            &gt; {MOVING} · window {BREATH_WINDOW_S} s
          </p>
        </details>
      )}
      <Link href="/">← All modes</Link>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Fingerprint } from '@senselab/dsp';
import { audio, type MicLease } from '../audio/engine';
import { HowTo } from '../components/howto/HowTo';
import { DoorbellAnim, SmokeAlarmAnim } from '../components/howto/animations';
import { LiveMic } from '../components/LiveMic';
import { SaveRecording } from '../components/SaveRecording';
import { api } from '../lib/api';
import { useDebug } from '../lib/debug';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { runDsp } from '../workers/dsp-client';

/** Window analysed on every scan, and how often. A T3 cycle is 4 s, so 6 s holds one whole. */
const WINDOW_S = 6;
const SCAN_MS = 500;
/** A taught sound counts above this normalised correlation. */
const MATCH = 0.75;
/** Don't repeat the same alert within this long. */
const COOLDOWN_MS = 10_000;
const TEACH_S = 6;

interface AlertEvent {
  at: Date;
  what: string;
  detail: string;
}

type WakeLockSentinelLike = { release: () => Promise<void> };

/** Copies the last `n` samples of a ring buffer out in order. */
function ringTail(ring: Float32Array, write: number, filled: number) {
  const n = Math.min(filled, ring.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ring[(write - n + i + ring.length) % ring.length];
  return out;
}

export function Alerts() {
  const debug = useDebug();
  const taught = useAsync(() => api.listExamples('alert'), 'alert');
  const templates = useMemo(
    () =>
      (taught.data ?? []).map((e) => ({
        id: e.id,
        label: e.label,
        fp: e.data as unknown as Fingerprint,
      })),
    [taught.data],
  );
  const [armed, setArmed] = useState(false);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [flash, setFlash] = useState<AlertEvent | null>(null);
  const [scores, setScores] = useState<{ label: string; score: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const templatesRef = useRef(templates);
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);
  useEffect(() => () => stopRef.current?.(), []);

  const notify = (e: AlertEvent) => {
    setFlash(e);
    setEvents((list) => [e, ...list].slice(0, 20));
    navigator.vibrate?.([400, 200, 400, 200, 400]);
    if ('Notification' in window && Notification.permission === 'granted') {
      void navigator.serviceWorker?.ready.then((r) =>
        r.showNotification(`SenseLab: ${e.what}`, {
          body: e.detail,
          tag: e.what,
          requireInteraction: true,
        }),
      );
    }
  };

  const arm = async () => {
    setError(null);
    let lease: MicLease;
    try {
      lease = await audio.acquire();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    // Asked from this tap; the alerts still show on screen without it.
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    let wake: WakeLockSentinelLike | null = null;
    try {
      wake =
        (await (
          navigator as Navigator & {
            wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> };
          }
        ).wakeLock?.request('screen')) ?? null;
    } catch {
      /* not supported or refused: the screen may sleep and stop listening */
    }
    const sr = lease.info.sampleRate;
    const ring = new Float32Array(Math.round(WINDOW_S * sr));
    let write = 0;
    let filled = 0;
    const off = audio.onChunk((c) => {
      for (let i = 0; i < c.length; i++) ring[(write + i) % ring.length] = c[i];
      write = (write + c.length) % ring.length;
      filled += c.length;
    });
    const last: Record<string, number> = {};
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || filled < sr * 2) return;
      busy = true;
      try {
        const x = ringTail(ring, write, filled);
        const t = templatesRef.current;
        const r = await runDsp(
          'alertsScan',
          x,
          sr,
          t.map(({ label, fp }) => ({ label, fp })),
        );
        setScores(r.matches.map((m) => ({ label: m.label, score: m.score })));
        const now = Date.now();
        const fire = (key: string, e: AlertEvent) => {
          if (now - (last[key] ?? 0) < COOLDOWN_MS) return;
          last[key] = now;
          notify(e);
        };
        if (r.alarm) {
          fire(r.alarm.kind, {
            at: new Date(),
            what: r.alarm.kind === 'smoke' ? 'Smoke / fire alarm' : 'Carbon monoxide alarm',
            detail: `${r.alarm.kind === 'smoke' ? 'Temporal-3' : 'Temporal-4'} beeps at ${Math.round(r.alarm.freq)} Hz`,
          });
        }
        for (const m of r.matches) {
          if (m.score >= MATCH)
            fire(`t:${m.label}`, {
              at: new Date(),
              what: m.label,
              detail: `match ${(m.score * 100).toFixed(0)}%`,
            });
        }
      } finally {
        busy = false;
      }
    }, SCAN_MS);
    stopRef.current = () => {
      clearInterval(timer);
      off();
      lease.release();
      void wake?.release();
      stopRef.current = null;
      setArmed(false);
    };
    setArmed(true);
  };

  return (
    <section className="stack">
      <div>
        <h1>🔔 Sound alerts</h1>
        <p className="muted">
          Listens for smoke and CO alarms (no setup), and for sounds you teach it: the doorbell, the
          washer finishing, the oven timer.
        </p>
      </div>

      {flash && (
        <button className="alert-flash block" onClick={() => setFlash(null)}>
          <strong>{flash.what}</strong>
          <span className="small">
            {flash.at.toLocaleTimeString()} · {flash.detail} · tap to dismiss
          </span>
        </button>
      )}

      <div className="card stack">
        <HowTo
          compact
          steps={[
            {
              art: <SmokeAlarmAnim />,
              title: 'Leave the phone where it can hear',
              text: 'Plugged in, screen on, this page open. Phones stop the mic when the screen locks or the browser goes to the background.',
            },
          ]}
        />
        {armed ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Listening…</strong>
              <span className="pill high">mic on</span>
            </div>
            <LiveMic />
            <button className="block" onClick={() => stopRef.current?.()}>
              Stop listening
            </button>
          </>
        ) : (
          <button className="primary block" onClick={arm}>
            Start listening
          </button>
        )}
        {error && <p className="error">{error}</p>}
        <p className="muted small">
          Listening for: smoke alarm (T3), CO alarm (T4)
          {templates.length ? `, ${templates.map((t) => t.label).join(', ')}` : ''}.
        </p>
      </div>

      {events.length > 0 && (
        <div className="card stack">
          <h2>Heard</h2>
          <ul className="list compact">
            {events.map((e, i) => (
              <li key={i} className="list-item row" style={{ justifyContent: 'space-between' }}>
                <strong>{e.what}</strong>
                <span className="muted small">
                  {e.at.toLocaleTimeString()} · {e.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Teach templates={templates} reload={taught.reload} disabled={armed} />

      {debug && armed && (
        <details className="debug" open>
          <summary>Debug: alerts</summary>
          <table className="numbers">
            <thead>
              <tr>
                <th>taught sound</th>
                <th>best match</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.label} className={s.score >= MATCH ? 'chosen' : ''}>
                  <td>{s.label}</td>
                  <td className="mono">{(s.score * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mono small">
            window {WINDOW_S} s · every {SCAN_MS} ms · match ≥ {MATCH * 100}% · cooldown{' '}
            {COOLDOWN_MS / 1000} s
          </p>
        </details>
      )}
      <Link href="/">← All modes</Link>
    </section>
  );
}

function Teach({
  templates,
  reload,
  disabled,
}: {
  templates: { id: string; label: string; fp: Fingerprint }[];
  reload: () => void;
  disabled: boolean;
}) {
  const debug = useDebug();
  const [label, setLabel] = useState('');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [rec, setRec] = useState<{ samples: Float32Array; sampleRate: number } | null>(null);
  const name = label.trim();

  const record = async () => {
    setNote(null);
    try {
      const { samples, sampleRate } = await audio.withMic(async (info) => {
        setPhase('recording');
        return { samples: await audio.record(TEACH_S), sampleRate: info.sampleRate };
      });
      setRec({ samples, sampleRate });
      setPhase('saving');
      const fp = await runDsp('makeFingerprint', samples, sampleRate);
      if (!fp) {
        setNote('That was too quiet to learn. Hold the phone closer to the sound and try again.');
        return;
      }
      await api.addExample({
        mode: 'alert',
        label: name,
        data: fp as unknown as Record<string, unknown>,
      });
      setNote(`Learned “${name}” (${(fp.frames.length * fp.hopS).toFixed(1)} s of sound).`);
      setLabel('');
      reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('idle');
    }
  };

  return (
    <div className="card stack">
      <h2>Teach a sound</h2>
      <HowTo
        compact
        steps={[
          {
            art: <DoorbellAnim />,
            title: 'Record it once, close up',
            text: `Name it, tap Record, then make the sound within ${TEACH_S} s (ring the bell, start the timer). Quiet room.`,
          },
        ]}
      />
      <label>
        Name
        <input
          value={label}
          maxLength={60}
          placeholder="doorbell"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <button
        className="primary block"
        onClick={record}
        disabled={!name || phase !== 'idle' || disabled}
      >
        {phase === 'recording'
          ? `Recording ${TEACH_S} s… make the sound`
          : phase === 'saving'
            ? 'Learning…'
            : 'Record'}
      </button>
      {disabled && <p className="muted small">Stop listening to teach a new sound.</p>}
      {note && <p className="ok-note">{note}</p>}
      {templates.length > 0 && (
        <ul className="list compact">
          {templates.map((t) => (
            <li key={t.id} className="list-item row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{t.label}</strong>{' '}
                <span className="muted small">{(t.fp.frames.length * t.fp.hopS).toFixed(1)} s</span>
              </span>
              <button
                className="small danger"
                aria-label={`Forget ${t.label}`}
                onClick={async () => {
                  await api.deleteExample(t.id);
                  reload();
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {debug && rec && (
        <SaveRecording
          samples={rec.samples}
          sampleRate={rec.sampleRate}
          mode="other"
          labels={{ mode: 'alert', label: name || 'taught' }}
        />
      )}
    </div>
  );
}

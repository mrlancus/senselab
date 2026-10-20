import { useMemo, useState } from 'react';
import {
  classifyKnock,
  firmnessIndex,
  leaveOneOut,
  mad,
  median,
  trainKnock,
  type KnockExample,
  type KnockFeatures,
  type KnockGuess,
} from '@senselab/dsp';
import type { Example } from '@senselab/shared';
import { HowTo } from '../components/howto/HowTo';
import { FruitTapAnim, KnockAnim } from '../components/howto/animations';
import { ImpactRecorder, motionPeaks, type ImpactRecording } from '../components/ImpactRecorder';
import { LinePlot, Waveform } from '../components/plots';
import { SaveRecording } from '../components/SaveRecording';
import { api } from '../lib/api';
import { motionNeedsPermission, requestMotionPermission } from '../lib/capabilities';
import { useDebug } from '../lib/debug';
import { Link } from '../lib/router';
import { useAsync } from '../lib/useAsync';
import { runDsp } from '../workers/dsp-client';

type Tab = 'identify' | 'teach' | 'fruit';
type Knocks = Awaited<ReturnType<typeof analyse>>;
const analyse = (r: ImpactRecording, onsets?: number[]) =>
  runDsp('knocks', r.samples, r.sampleRate, onsets ? motionPeaks(r, onsets) : []);

/** Runs the knock analysis twice when motion was recorded: once for onsets, once with IMU peaks. */
async function knocksOf(r: ImpactRecording) {
  const first = await analyse(r);
  return r.motion
    ? analyse(
        r,
        first.map((k) => k.onsetS),
      )
    : first;
}

const toExamples = (rows: Example[]): KnockExample[] =>
  rows.map((e) => ({ id: e.id, label: e.label, features: e.data as unknown as KnockFeatures }));

export function Knock() {
  const [tab, setTab] = useState<Tab>('identify');
  const [useMotion, setUseMotion] = useState(false);
  const ex = useAsync(() => api.listExamples('knock'), 'knock');
  const examples = useMemo(() => toExamples(ex.data ?? []), [ex.data]);

  return (
    <section className="stack">
      <div>
        <h1>✊ Knock ID</h1>
        <p className="muted">
          Teach it what things sound like when knocked, then let it tell them apart. Or check how
          firm a fruit is.
        </p>
      </div>
      <div className="segmented" role="tablist">
        {(
          [
            ['identify', 'Identify'],
            ['teach', 'Teach'],
            ['fruit', 'Fruit'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'on' : ''}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab !== 'fruit' && 'DeviceMotionEvent' in window && (
        <label className="inline small">
          <input
            type="checkbox"
            checked={useMotion}
            style={{ width: 'auto', minHeight: 0 }}
            onChange={async (e) => {
              const on = e.target.checked;
              setUseMotion(on && (!motionNeedsPermission() || (await requestMotionPermission())));
            }}
          />
          Also feel the knock with the motion sensor (phone resting on the object)
        </label>
      )}
      {ex.error && <p className="error">{ex.error}</p>}
      {tab === 'identify' && (
        <Identify examples={examples} useMotion={useMotion} goTeach={() => setTab('teach')} />
      )}
      {tab === 'teach' && <Teach examples={examples} useMotion={useMotion} reload={ex.reload} />}
      {tab === 'fruit' && <Fruit />}
      <Link href="/">← All modes</Link>
    </section>
  );
}

const knockStep = {
  art: <KnockAnim />,
  title: 'Knock 3–5 times, the same way',
  text: 'One knuckle, same spot, about a second apart. Phone within 30 cm, quiet room.',
};

function Identify({
  examples,
  useMotion,
  goTeach,
}: {
  examples: KnockExample[];
  useMotion: boolean;
  goTeach: () => void;
}) {
  const debug = useDebug();
  const model = useMemo(() => trainKnock(examples), [examples]);
  const [result, setResult] = useState<{
    rec: ImpactRecording;
    knocks: Knocks;
    guesses: KnockGuess[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (model.labels.length < 2) {
    return (
      <div className="card stack">
        <p>
          Teach at least two kinds of thing first (for example "hollow door" and "solid wall"), with
          3–5 knocks each.
        </p>
        <button className="primary block" onClick={goTeach}>
          Teach
        </button>
      </div>
    );
  }

  const onRecorded = async (rec: ImpactRecording) => {
    setError(null);
    const knocks = await knocksOf(rec);
    if (!knocks.length) {
      setResult(null);
      setError('No knock heard. Knock firmly, closer to the phone.');
      return;
    }
    setResult({ rec, knocks, guesses: knocks.map((k) => classifyKnock(model, k.features)) });
  };

  // Combine the knocks: sum the vote shares per label.
  const combined = result && combine(result.guesses);
  return (
    <div className="stack">
      <HowTo compact steps={[knockStep]} />
      {combined && (
        <div className="card stack">
          {combined.label ? (
            <>
              <span className="big-number">{combined.label}</span>
              <span className="muted small">
                {(combined.confidence * 100).toFixed(0)}% of the vote over {result!.guesses.length}{' '}
                knock{result!.guesses.length === 1 ? '' : 's'}
                {combined.runnerUp ? ` · next: ${combined.runnerUp}` : ''}
              </span>
            </>
          ) : (
            <p className="notice">
              That doesn't sound like anything you've taught yet (it's
              {` ${combined.novelty.toFixed(1)}× `}further than your examples are from each other).
              Teach it as a new kind?
            </p>
          )}
        </div>
      )}
      <ImpactRecorder label="knock now" target={3} withMotion={useMotion} onRecorded={onRecorded} />
      {error && <p className="error">{error}</p>}
      {debug && result && (
        <KnockDebug rec={result.rec} knocks={result.knocks} guesses={result.guesses} />
      )}
    </div>
  );
}

function combine(guesses: KnockGuess[]) {
  const score: Record<string, number> = {};
  for (const g of guesses) {
    if (!g.label) continue;
    const total = Object.values(g.votes).reduce((a, b) => a + b, 0) || 1;
    for (const [l, v] of Object.entries(g.votes)) score[l] = (score[l] ?? 0) + v / total;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const known = guesses.filter((g) => g.label).length;
  return {
    label: known * 2 >= guesses.length && ranked[0] ? ranked[0][0] : null,
    confidence: ranked[0] ? ranked[0][1] / guesses.length : 0,
    runnerUp: ranked[1]?.[0] ?? null,
    novelty: median(guesses.map((g) => g.novelty)),
  };
}

function Teach({
  examples,
  useMotion,
  reload,
}: {
  examples: KnockExample[];
  useMotion: boolean;
  reload: () => void;
}) {
  const [label, setLabel] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of examples) c[e.label] = (c[e.label] ?? 0) + 1;
    return c;
  }, [examples]);
  const loo = useMemo(() => leaveOneOut(examples), [examples]);
  const name = label.trim();

  const onRecorded = async (rec: ImpactRecording) => {
    setError(null);
    const knocks = await knocksOf(rec);
    if (!knocks.length) {
      setError('No knock heard. Knock firmly, closer to the phone.');
      return;
    }
    for (const k of knocks) {
      await api.addExample({
        mode: 'knock',
        label: name,
        data: k.features as unknown as Record<string, unknown>,
      });
    }
    setNote(`Saved ${knocks.length} knock${knocks.length === 1 ? '' : 's'} as “${name}”.`);
    reload();
  };

  return (
    <div className="stack">
      <div className="card stack">
        <label>
          What are you knocking on?
          <input
            value={label}
            list="knock-labels"
            maxLength={60}
            placeholder="hollow door"
            onChange={(e) => setLabel(e.target.value)}
          />
          <datalist id="knock-labels">
            {Object.keys(counts).map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
        <HowTo compact steps={[knockStep]} />
        {name ? (
          <ImpactRecorder
            label={`knock on ${name}`}
            target={5}
            withMotion={useMotion}
            onRecorded={onRecorded}
          />
        ) : (
          <p className="muted small">Name it first.</p>
        )}
        {note && <p className="ok-note">{note}</p>}
        {error && <p className="error">{error}</p>}
      </div>
      {Object.keys(counts).length > 0 && (
        <div className="card stack">
          <h2>Taught so far</h2>
          <ul className="list compact">
            {Object.entries(counts).map(([l, n]) => (
              <li key={l} className="list-item row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{l}</strong> <span className="muted small">{n} knocks</span>
                </span>
                <button
                  className="small danger"
                  aria-label={`Delete ${l}`}
                  onClick={async () => {
                    if (!confirm(`Delete all ${n} “${l}” knocks?`)) return;
                    await api.deleteExampleLabel('knock', l);
                    reload();
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {loo != null && (
            <p className={loo >= 0.8 ? 'muted small' : 'notice small'}>
              Self-test: {(loo * 100).toFixed(0)}% of your knocks are recognised when left out.
              {loo < 0.8 && ' Some kinds sound alike; add more knocks or knock more consistently.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function KnockDebug({
  rec,
  knocks,
  guesses,
}: {
  rec: ImpactRecording;
  knocks: Knocks;
  guesses: KnockGuess[];
}) {
  return (
    <details className="debug" open>
      <summary>Debug: knocks</summary>
      <Waveform
        data={rec.samples}
        sampleRate={rec.sampleRate}
        markers={knocks.map((k, i) => ({ x: k.onsetS, label: String(i + 1) }))}
      />
      {knocks.slice(0, 3).map((k, i) => (
        <div key={i}>
          <h3>Knock {i + 1}: band shape (dB re mean, 100 Hz → 8 kHz)</h3>
          <LinePlot y={Float32Array.from(k.features.bandsDb)} height={70} />
        </div>
      ))}
      <table className="numbers">
        <thead>
          <tr>
            <th>#</th>
            <th>peak Hz</th>
            <th>centroid</th>
            <th>decay ms</th>
            <th>tonal dB</th>
            <th>IMU</th>
            <th>guess</th>
          </tr>
        </thead>
        <tbody>
          {knocks.map((k, i) => (
            <tr key={i}>
              <td className="mono">{i + 1}</td>
              <td className="mono">{k.features.peakHz.toFixed(0)}</td>
              <td className="mono">{k.features.centroidHz.toFixed(0)}</td>
              <td className="mono">{(k.features.decayS * 1000).toFixed(0)}</td>
              <td className="mono">{k.features.tonalityDb.toFixed(0)}</td>
              <td className="mono">
                {k.features.imuPeak != null ? k.features.imuPeak.toFixed(2) : '—'}
              </td>
              <td className="mono">
                {guesses[i]?.label ?? '?'} ({guesses[i]?.novelty.toFixed(1)}×)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SaveRecording
        samples={rec.samples}
        sampleRate={rec.sampleRate}
        mode="knock"
        labels={{ guess: guesses[0]?.label ?? 'unknown', knocks: knocks.length }}
      />
    </details>
  );
}

interface FruitReading {
  frequencyHz: number;
  massKg: number;
  firmness: number;
  taps: number;
}

function Fruit() {
  const debug = useDebug();
  const log = useAsync(() => api.listExamples('fruit'), 'fruit');
  const [name, setName] = useState('');
  const [mass, setMass] = useState('');
  const [last, setLast] = useState<
    (FruitReading & { spreadHz: number; rec: ImpactRecording }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const kg = parseFloat(mass.replace(',', '.'));
  const byFruit = useMemo(() => {
    const g: Record<string, (FruitReading & { at: string })[]> = {};
    for (const e of log.data ?? [])
      (g[e.label] ??= []).push({ ...(e.data as unknown as FruitReading), at: e.createdAt });
    return g;
  }, [log.data]);

  const onRecorded = async (rec: ImpactRecording) => {
    setError(null);
    const taps = await runDsp('fruitTaps', rec.samples, rec.sampleRate);
    if (!taps.length) {
      setError('No clear ring heard. Flick firmly with a fingertip, phone close to the fruit.');
      return;
    }
    const f = taps.map((t) => t.frequency);
    const frequencyHz = median(f);
    const reading = {
      frequencyHz,
      massKg: kg,
      firmness: firmnessIndex(frequencyHz, kg),
      taps: taps.length,
    };
    setLast({ ...reading, spreadHz: 1.4826 * mad(f), rec });
    await api.addExample({ mode: 'fruit', label: name.trim() || 'fruit', data: { ...reading } });
    log.reload();
  };

  return (
    <div className="stack">
      <HowTo
        compact
        steps={[
          {
            art: <FruitTapAnim />,
            title: 'Weigh it, then flick it 3–4 times',
            text: 'Hold the fruit loosely (or on a towel), flick firmly with a fingertip, phone 10–20 cm away.',
          },
        ]}
      />
      <div className="field-row" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <label>
          Which fruit
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="melon #1"
            list="fruit-names"
          />
          <datalist id="fruit-names">
            {Object.keys(byFruit).map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
        <label>
          Weight (kg)
          <input
            inputMode="decimal"
            value={mass}
            onChange={(e) => setMass(e.target.value)}
            placeholder="1.8"
          />
        </label>
      </div>
      {kg > 0 && kg < 50 ? (
        <ImpactRecorder label="flick the fruit" target={4} onRecorded={onRecorded} />
      ) : (
        <p className="muted small">Enter the weight first (a kitchen scale is fine).</p>
      )}
      {error && <p className="error">{error}</p>}
      {last && (
        <div className="card stack">
          <span className="big-number">S ≈ {(last.firmness / 1e4).toFixed(2)}</span>
          <span className="muted small mono">
            {last.frequencyHz.toFixed(0)} ± {last.spreadHz.toFixed(0)} Hz · {last.massKg} kg · S =
            f²·m^⅔ (×10⁴)
          </span>
          <p className="small">
            Lower = softer. Fruit softens as it ripens, so compare the same fruit over days, or
            against one you know is ripe. Different varieties have different ranges.
          </p>
        </div>
      )}
      {Object.keys(byFruit).length > 0 && (
        <div className="card stack">
          <h2>Your fruit</h2>
          <table className="numbers">
            <thead>
              <tr>
                <th>fruit</th>
                <th>date</th>
                <th>Hz</th>
                <th>S ×10⁴</th>
                <th>vs first</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byFruit).flatMap(([l, rows]) =>
                rows.map((r, i) => (
                  <tr key={l + i}>
                    <td>{i === 0 ? l : ''}</td>
                    <td className="mono">{new Date(r.at).toLocaleDateString()}</td>
                    <td className="mono">{r.frequencyHz.toFixed(0)}</td>
                    <td className="mono">{(r.firmness / 1e4).toFixed(2)}</td>
                    <td className="mono">
                      {i ? `${((r.firmness / rows[0].firmness - 1) * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      {debug && last && (
        <details className="debug" open>
          <summary>Debug: fruit</summary>
          <Waveform data={last.rec.samples} sampleRate={last.rec.sampleRate} />
          <SaveRecording
            samples={last.rec.samples}
            sampleRate={last.rec.sampleRate}
            mode="knock"
            labels={{
              fruit: name || 'fruit',
              massKg: last.massKg,
              pitchHz: +last.frequencyHz.toFixed(1),
            }}
          />
        </details>
      )}
    </div>
  );
}

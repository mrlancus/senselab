import { useState, type ReactNode } from 'react';
import {
  bucketFromViews,
  cardHomography,
  frustumCapacityLitres,
  frustumLitresAtLevel,
  measureSideView,
  measureTopView,
  REFERENCES,
  waterDepthWithShape,
  type Point,
  type SideViewResult,
  type TopViewResult,
} from '@senselab/dsp';
import { HowTo } from '../../components/howto/HowTo';
import { CardOnRimAnim, CardOnSideAnim } from '../../components/howto/animations';
import { PhotoTapper, type TapResult, type TapStep } from '../../components/PhotoTapper';
import { api, type ContainerDetail } from '../../lib/api';
import { useDebug } from '../../lib/debug';
import { Link, navigate } from '../../lib/router';
import { useAsync } from '../../lib/useAsync';
import { XrMeasure } from './XrMeasure';

const TOP_STEPS: TapStep[] = [
  { key: 'card', prompt: 'Tap the 4 corners of the card', min: 4, max: 4 },
  {
    key: 'rim',
    prompt: 'Tap 4–8 points spread around the inside edge of the rim',
    min: 3,
    max: 12,
  },
];

const SIDE_STEPS: TapStep[] = [
  { key: 'card', prompt: 'Tap the 4 corners of the card', min: 4, max: 4 },
  { key: 'rimFront', prompt: 'Tap the top of the rim straight above the card', min: 1, max: 1 },
  {
    key: 'baseFront',
    prompt: 'Tap the bottom of the base straight below the card',
    min: 1,
    max: 1,
  },
  {
    key: 'waterFront',
    prompt: 'Translucent? Tap the waterline above the card (or skip)',
    min: 0,
    max: 1,
    optional: true,
  },
  { key: 'top', prompt: 'Tap the left and right ends of the rim', min: 2, max: 2 },
  { key: 'bottom', prompt: 'Tap the left and right ends of the base', min: 2, max: 2 },
];

const WATER_STEPS: TapStep[] = [
  { key: 'card', prompt: 'Tap the 4 corners of the card', min: 4, max: 4 },
  {
    key: 'baseFront',
    prompt: 'Tap the bottom of the base straight below the card',
    min: 1,
    max: 1,
  },
  { key: 'waterFront', prompt: 'Tap the waterline straight above the card', min: 1, max: 1 },
];

/** Length of the reference's longest side in the photo, px (debug view). */
const cardPx = (card: Point[], ref = REFERENCES.card) => {
  const { ordered } = cardHomography(card, ref);
  return Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
};

export function CameraMeasure({ id, view }: { id: string; view: 'dimensions' | 'waterline' }) {
  const { data, error } = useAsync(() => api.getContainer(id), id);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return view === 'waterline' ? <Waterline c={data} /> : <Dimensions c={data} />;
}

function Photo({
  title,
  howTitle,
  art,
  text,
  steps,
  onTaps,
  children,
}: {
  title: string;
  howTitle: string;
  art: ReactNode;
  text: string;
  steps: TapStep[];
  onTaps: (t: TapResult | null, tapPx: number) => void;
  children?: ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [done, setDone] = useState(false);
  const [taps, setTaps] = useState<TapResult | null>(null);
  return (
    <div className="card stack">
      <h2>{title}</h2>
      <HowTo compact steps={[{ art, title: howTitle, text }]} />
      <label className="button block file-button">
        {file ? 'Retake photo' : 'Take photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setDone(false);
            onTaps(null, 1);
          }}
        />
      </label>
      {file && !done && (
        <PhotoTapper
          key={file.name + file.size + file.lastModified}
          file={file}
          steps={steps}
          onDone={(t, info) => {
            setDone(true);
            setTaps(t);
            onTaps(t, info.tapPx);
          }}
        />
      )}
      {done && (
        <button className="small" onClick={() => (setDone(false), onTaps(null, 1))}>
          Re-tap points
        </button>
      )}
      {children}
      {file && <PhotoDebug file={file} taps={done ? taps : null} />}
    </div>
  );
}

function Dimensions({ c }: { c: ContainerDetail }) {
  const debug = useDebug();
  const [top, setTop] = useState<{ r: TopViewResult; px: number; taps: TapResult } | null>(null);
  const [side, setSide] = useState<{ r: SideViewResult; px: number; taps: TapResult } | null>(null);
  const [base, setBase] = useState('1');
  const [ref, setRef] = useState<keyof typeof REFERENCES>('card');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const baseCm = parseFloat(base.replace(',', '.'));
  const dims =
    top && side && baseCm >= 0 && baseCm < 10 ? bucketFromViews(top.r, side.r, baseCm) : null;

  const tryRun = (fn: () => void) => {
    setErr(null);
    try {
      fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="stack">
      <div>
        <Link href={`/level/${c.id}`} className="small">
          ← {c.name}
        </Link>
        <h1>📷 Measure with the camera</h1>
        <p className="muted small">
          A bank card (85.6 × 54 mm) is the ruler. Two photos give the inside top diameter, the
          bottom diameter and the height.
        </p>
      </div>
      <XrMeasure />
      <label>
        Top-view reference
        <select value={ref} onChange={(e) => setRef(e.target.value as keyof typeof REFERENCES)}>
          <option value="card">Bank card (85.6 × 54 mm)</option>
          <option value="a4">A4 sheet (297 × 210 mm): about 3× more accurate</option>
          <option value="letter">US Letter sheet (11 × 8.5 in)</option>
        </select>
      </label>
      <Photo
        title="1. Top view"
        howTitle={ref === 'card' ? 'Card flat on the rim' : 'Sheet flat on the rim'}
        art={<CardOnRimAnim />}
        text={`Lay the ${ref === 'card' ? 'card' : 'sheet'} flat on the rim${ref === 'card' ? ', half over the opening' : ', leaving part of the rim edge visible'}. Photograph from straight above, with the whole rim filling the frame.`}
        steps={
          ref === 'card'
            ? TOP_STEPS
            : TOP_STEPS.map((s, i) => (i ? s : { ...s, prompt: 'Tap the 4 corners of the sheet' }))
        }
        onTaps={(t, tapPx) =>
          t
            ? tryRun(() =>
                setTop({
                  r: measureTopView({ card: t.card, rim: t.rim, ref: REFERENCES[ref] }, tapPx),
                  px: cardPx(t.card, REFERENCES[ref]),
                  taps: t,
                }),
              )
            : setTop(null)
        }
      >
        {top && (
          <>
            <p className="ok-note">
              Inside top ⌀ {top.r.diameterCm.toFixed(1)} ± {top.r.uncertaintyCm.toFixed(1)} cm
            </p>
            {top.r.uncertaintyCm / top.r.diameterCm > 0.03 && <CardTooSmall />}
          </>
        )}
      </Photo>
      <Photo
        title="2. Side view"
        howTitle="Card taped upright on the wall"
        art={<CardOnSideAnim />}
        text="Tape the card upright (long edge vertical) on the outside wall, halfway up. Step back 1–2 m, phone level with the middle of the bucket, and zoom in until the bucket fills the frame."
        steps={SIDE_STEPS}
        onTaps={(t, tapPx) =>
          t
            ? tryRun(() =>
                setSide({
                  r: measureSideView(
                    {
                      card: t.card,
                      rimFront: t.rimFront[0],
                      baseFront: t.baseFront[0],
                      waterFront: t.waterFront?.[0] ?? null,
                      topLeft: t.top[0],
                      topRight: t.top[1],
                      bottomLeft: t.bottom[0],
                      bottomRight: t.bottom[1],
                    },
                    tapPx,
                  ),
                  px: cardPx(t.card),
                  taps: t,
                }),
              )
            : setSide(null)
        }
      >
        {side && (
          <>
            <p className="ok-note">
              Wall {side.r.slantCm.toFixed(1)} ± {side.r.uncertaintyCm.toFixed(1)} cm rim to base ·
              bottom/top {side.r.taperRatio.toFixed(3)}
            </p>
            {side.r.uncertaintyCm / side.r.slantCm > 0.03 && <CardTooSmall />}
          </>
        )}
      </Photo>
      {err && <p className="error">{err}</p>}

      {top && side && (
        <div className="card stack">
          <h2>Inside dimensions</h2>
          <label>
            Base thickness (cm), the gap between the outside bottom and the inside floor
            <input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
          </label>
          {dims && (
            <>
              <dl className="kv">
                <dt>Top ⌀</dt>
                <dd className="mono">
                  {dims.topDiameterCm.toFixed(1)} ± {dims.uncertainty.topCm.toFixed(1)} cm
                </dd>
                <dt>Bottom ⌀</dt>
                <dd className="mono">
                  {dims.bottomDiameterCm.toFixed(1)} ± {dims.uncertainty.bottomCm.toFixed(1)} cm
                </dd>
                <dt>Height</dt>
                <dd className="mono">
                  {dims.heightCm.toFixed(1)} ± {dims.uncertainty.heightCm.toFixed(1)} cm
                </dd>
                <dt>Capacity</dt>
                <dd className="mono">≈ {frustumCapacityLitres(dims).toFixed(1)} L</dd>
                {dims.waterDepthCm != null && (
                  <>
                    <dt>Water now</dt>
                    <dd className="mono">
                      {dims.waterDepthCm.toFixed(1)} cm ≈{' '}
                      {frustumLitresAtLevel(dims, dims.waterDepthCm).toFixed(1)} L
                    </dd>
                  </>
                )}
              </dl>
              <button
                className="primary block"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const round = (v: number) => Math.round(v * 10) / 10;
                  await api.updateContainer(c.id, {
                    name: c.name,
                    material: c.material,
                    shape: {
                      topDiameterCm: round(dims.topDiameterCm),
                      bottomDiameterCm: round(dims.bottomDiameterCm),
                      heightCm: round(dims.heightCm),
                    },
                  });
                  navigate(`/level/${c.id}`);
                }}
              >
                Save these dimensions
              </button>
            </>
          )}
        </div>
      )}
      {debug && (top || side) && (
        <details className="debug" open>
          <summary>Debug: camera</summary>
          <pre className="mono small">
            {JSON.stringify(
              {
                top: top && { ...top.r, cardPx: top.px, taps: top.taps },
                side: side && { ...side.r, cardPx: side.px, taps: side.taps },
              },
              (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v),
              1,
            )}
          </pre>
        </details>
      )}
    </section>
  );
}

function Waterline({ c }: { c: ContainerDetail }) {
  const [result, setResult] = useState<{ depthCm: number; litres: number; sigmaCm: number } | null>(
    null,
  );
  const [base, setBase] = useState('1');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shape = c.shape;
  if (!shape) {
    return (
      <section className="stack">
        <p>The waterline method needs the bucket's dimensions first.</p>
        <Link href={`/level/${c.id}/camera`} className="button">
          Measure dimensions with the camera
        </Link>
      </section>
    );
  }
  const baseCm = parseFloat(base.replace(',', '.')) || 0;
  const confidence = result ? Math.exp(-result.sigmaCm / 1.5) : 0;
  return (
    <section className="stack">
      <div>
        <Link href={`/level/${c.id}`} className="small">
          ← {c.name}
        </Link>
        <h1>📷 Waterline</h1>
        <p className="muted small">
          For translucent buckets: the water shows through the wall. One side photo with the card
          taped on gives the water depth, and the bucket's shape gives litres.
        </p>
      </div>
      <label>
        Base thickness (cm)
        <input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
      </label>
      <Photo
        title="Side view"
        howTitle="Card on the wall, below the waterline"
        art={<CardOnSideAnim />}
        text="Card upright on the outside wall, below the waterline if you can. Step back 1–2 m, phone level with the water, zoom in."
        steps={WATER_STEPS}
        onTaps={(t, tapPx) => {
          setSaved(false);
          setErr(null);
          if (!t) return setResult(null);
          try {
            const side = measureSideView(
              {
                card: t.card,
                rimFront: t.waterFront[0],
                baseFront: t.baseFront[0],
                waterFront: t.waterFront[0],
                topLeft: t.card[0],
                topRight: t.card[1],
                bottomLeft: t.card[0],
                bottomRight: t.card[1],
              },
              tapPx,
            );
            const depthCm = waterDepthWithShape(side.waterSlantCm!, shape, baseCm);
            setResult({
              depthCm,
              litres: frustumLitresAtLevel(shape, depthCm),
              sigmaCm: Math.hypot(side.uncertaintyCm, 0.3),
            });
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {result && (
          <div className="stack">
            <span className="big-number">≈ {result.litres.toFixed(1)} L</span>
            <span className="mono muted">
              water {result.depthCm.toFixed(1)} ± {result.sigmaCm.toFixed(1)} cm deep
            </span>
            {result.sigmaCm > 1 && <CardTooSmall />}
            <button
              className="primary block"
              disabled={saved}
              onClick={async () => {
                await api.addMeasurement(c.id, {
                  method: 'camera',
                  rawValue: result.depthCm,
                  estimatedLitres: result.litres,
                  confidence,
                  recordingKey: null,
                });
                setSaved(true);
              }}
            >
              {saved ? 'Saved' : 'Save measurement'}
            </button>
          </div>
        )}
      </Photo>
      {err && <p className="error">{err}</p>}
    </section>
  );
}

function CardTooSmall() {
  return (
    <p className="notice small">
      The reference looks small in this photo, so tap precision limits accuracy (over 3%). Get
      closer or zoom in so it's bigger (keeping the whole bucket in view), or for the top view, use
      an A4 sheet instead of the card.
    </p>
  );
}

/** Taps as "key:x,y;x,y|key:…" in whole pixels, to fit a 200-character label. */
const compactTaps = (t: TapResult) =>
  Object.entries(t)
    .map(([k, pts]) => `${k}:${pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';')}`)
    .join('|')
    .slice(0, 200);

function PhotoDebug({ file, taps }: { file: File; taps: TapResult | null }) {
  const debug = useDebug();
  const [state, setState] = useState<string | null>(null);
  if (!debug) return null;
  return (
    <div className="row small">
      <button
        className="small"
        onClick={async () => {
          setState('Uploading…');
          try {
            const r = await api.uploadRecording(file, {
              mode: 'camera',
              labels: {
                name: file.name.slice(0, 100),
                bytes: file.size,
                ...(taps ? { taps: compactTaps(taps) } : {}),
              },
            });
            setState(`Saved ${r.key}`);
          } catch (e) {
            setState(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Save photo to cloud
      </button>
      {state && <span className="muted mono">{state}</span>}
    </div>
  );
}

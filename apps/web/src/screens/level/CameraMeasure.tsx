import { useState } from 'react';
import {
  bucketFromViews,
  cardHomography,
  frustumCapacityLitres,
  frustumLitresAtLevel,
  measureSideView,
  measureTopView,
  proportionsFromSilhouette,
  waterDepthFromProportions,
  REFERENCES,
  type Point,
  type SideViewResult,
  type TopViewResult,
} from '@senselab/dsp';
import { CardOnRimAnim, CardOnSideAnim } from '../../components/howto/animations';
import { type TapResult, type TapStep } from '../../components/PhotoTapper';
import { CardTooSmall, Photo } from './CameraPhoto';
import { NoReference } from './CameraNoReference';
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
  { key: 'top', prompt: 'Tap the left and right ends of the rim', min: 2, max: 2 },
  { key: 'bottom', prompt: 'Tap the left and right ends of the base', min: 2, max: 2 },
  { key: 'water', prompt: 'Tap both ends of the waterline', min: 2, max: 2 },
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

function Dimensions({ c }: { c: ContainerDetail }) {
  const [method, setMethod] = useState<'none' | 'card'>('none');
  return (
    <section className="stack">
      <div>
        <Link href={`/level/${c.id}`} className="small">
          ← {c.name}
        </Link>
        <h1>📷 Measure with the camera</h1>
        <p className="muted small">
          Finds the bucket's inside top diameter, bottom diameter and height, so tap and echo can
          turn readings into litres.
        </p>
      </div>
      <XrMeasure />
      <div className="segmented" role="tablist" aria-label="Method">
        <button
          role="tab"
          aria-selected={method === 'none'}
          className={method === 'none' ? 'on' : ''}
          onClick={() => setMethod('none')}
        >
          No reference
        </button>
        <button
          role="tab"
          aria-selected={method === 'card'}
          className={method === 'card' ? 'on' : ''}
          onClick={() => setMethod('card')}
        >
          Card or A4 sheet
        </button>
      </div>
      <p className="muted small">
        {method === 'none'
          ? 'One side photo for the shape, plus one number you already have for the size: the capacity printed on the bucket, any one length, or its depth measured by sound.'
          : 'Most accurate: a bank card or sheet of paper in the photo is the ruler. Two photos.'}
      </p>
      {method === 'none' ? <NoReference c={c} /> : <CardDimensions c={c} />}
    </section>
  );
}

function CardDimensions({ c }: { c: ContainerDetail }) {
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
          For translucent buckets: the water shows through the wall. One level side photo gives the
          waterline's share of the height, and the bucket's dimensions turn that into litres. No
          card needed.
        </p>
      </div>
      <label>
        Base thickness (cm)
        <input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
      </label>
      <Photo
        title="Side view"
        howTitle="Phone level with the water, 1.5–2 m back"
        art={<CardOnSideAnim />}
        text="Zoom in so the bucket fills most of the frame. Hold the phone level, not tilted up or down."
        steps={WATER_STEPS}
        onTaps={(t, tapPx) => {
          setSaved(false);
          if (!t) return setResult(null);
          const p = proportionsFromSilhouette(
            {
              topLeft: t.top[0],
              topRight: t.top[1],
              bottomLeft: t.bottom[0],
              bottomRight: t.bottom[1],
              waterLeft: t.water[0],
              waterRight: t.water[1],
            },
            tapPx,
          );
          const w = waterDepthFromProportions(p, shape, baseCm)!;
          setResult({ ...w, litres: frustumLitresAtLevel(shape, w.depthCm) });
        }}
      >
        {result && (
          <div className="stack">
            <span className="big-number">≈ {result.litres.toFixed(1)} L</span>
            <span className="mono muted">
              water {result.depthCm.toFixed(1)} ± {result.sigmaCm.toFixed(1)} cm deep
            </span>
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
    </section>
  );
}

import { useState } from 'react';
import {
  DEFAULT_ECHO_OFFSET_CM,
  DEFAULT_ECHO_OFFSET_SIGMA_CM,
  frustumCapacityLitres,
  frustumLitresAtLevel,
  proportionsFromSilhouette,
  scaleProportions,
  type Proportions,
  type ScaleSource,
} from '@senselab/dsp';
import { EchoCapture } from '../../components/EchoCapture';
import { CardOnSideAnim, PhoneOverBucketAnim } from '../../components/howto/animations';
import type { TapStep } from '../../components/PhotoTapper';
import { api, type ContainerDetail } from '../../lib/api';
import { navigate } from '../../lib/router';
import { Photo } from './CameraPhoto';

const STEPS: TapStep[] = [
  { key: 'top', prompt: 'Tap the left and right ends of the rim', min: 2, max: 2 },
  { key: 'bottom', prompt: 'Tap the left and right ends of the base', min: 2, max: 2 },
  {
    key: 'water',
    prompt: 'Translucent? Tap both ends of the waterline (or skip)',
    min: 0,
    max: 2,
    optional: true,
  },
];

type Kind = ScaleSource['kind'];
const num = (v: string) => parseFloat(v.replace(',', '.'));

/**
 * Dimensions with no card or sheet: one level side photo gives the proportions (top,
 * bottom, height), and one number the user already has gives the scale.
 */
export function NoReference({ c }: { c: ContainerDetail }) {
  const [prop, setProp] = useState<Proportions | null>(null);
  const [kind, setKind] = useState<Kind>('capacity');
  const [litres, setLitres] = useState('');
  const [which, setWhich] = useState<'height' | 'top'>('height');
  const [length, setLength] = useState('');
  const [depth, setDepth] = useState<number | null>(null);
  const [wall, setWall] = useState('0.3');
  const [base, setBase] = useState('1');
  const [saving, setSaving] = useState(false);

  const source: ScaleSource | null =
    kind === 'capacity' && num(litres) > 0
      ? { kind, litres: num(litres) }
      : kind === 'length' && num(length) > 0
        ? { kind, which, cm: num(length) }
        : kind === 'depth' && depth
          ? { kind, cm: depth, sigmaCm: DEFAULT_ECHO_OFFSET_SIGMA_CM }
          : null;
  const dims =
    prop && source
      ? scaleProportions(prop, source, { wallCm: num(wall) || 0, baseCm: num(base) || 0 })
      : null;

  return (
    <div className="stack">
      <Photo
        title="1. One side photo"
        howTitle="Phone level, 1.5–2 m back"
        art={<CardOnSideAnim />}
        text="Stand back and zoom in until the bucket fills most of the frame, with the phone level with the middle of the bucket and not tilted. Translucent bucket? Get the waterline in too."
        steps={STEPS}
        onTaps={(t, tapPx) =>
          setProp(
            t
              ? proportionsFromSilhouette(
                  {
                    topLeft: t.top[0],
                    topRight: t.top[1],
                    bottomLeft: t.bottom[0],
                    bottomRight: t.bottom[1],
                    waterLeft: t.water?.[0] ?? null,
                    waterRight: t.water?.[1] ?? null,
                  },
                  tapPx,
                )
              : null,
          )
        }
      >
        {prop && (
          <p className="ok-note">
            Shape: bottom/top {(prop.bottomPx / prop.topPx).toFixed(3)} · height/top{' '}
            {(prop.heightPx / prop.topPx).toFixed(3)}
          </p>
        )}
      </Photo>

      {prop && (
        <div className="card stack">
          <h2>2. One number for the scale</h2>
          <div className="segmented" role="tablist" aria-label="Scale from">
            {(
              [
                ['capacity', 'Printed size'],
                ['length', 'One length'],
                ['depth', 'By sound'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                className={kind === k ? 'on' : ''}
                onClick={() => setKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === 'capacity' && (
            <label>
              Capacity printed or moulded on the bucket (litres)
              <input
                inputMode="decimal"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
                placeholder="10"
              />
              <span className="muted small">
                Usually on the side or underneath. It's normally the brim-full volume; if it's a
                fill line instead, sizes come out ~2% small.
              </span>
            </label>
          )}
          {kind === 'length' && (
            <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label>
                Which length
                <select
                  value={which}
                  onChange={(e) => setWhich(e.target.value as 'height' | 'top')}
                >
                  <option value="height">Outside height</option>
                  <option value="top">Outside top width</option>
                </select>
              </label>
              <label>
                cm
                <input
                  inputMode="decimal"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  placeholder="25"
                />
              </label>
            </div>
          )}
          {kind === 'depth' && (
            <>
              <p className="small">
                Empty the bucket, then ping its depth with sound: phone upright at the rim, bottom
                edge pointing down (±1.5 cm).
              </p>
              <EchoCapture
                steps={[
                  {
                    art: <PhoneOverBucketAnim level={0} />,
                    title: 'Empty bucket, phone at the rim',
                    text: 'Bottom edge pointing straight down at the floor of the bucket.',
                  },
                ]}
                minCm={8}
                maxCm={90}
                labels={{ container: c.name, containerId: c.id, purpose: 'camera-depth' }}
                renderResult={(a) =>
                  a.best ? (
                    <span>
                      Inside depth{' '}
                      <strong className="mono">
                        {(a.best.rawCm + DEFAULT_ECHO_OFFSET_CM).toFixed(1)} cm
                      </strong>
                    </span>
                  ) : null
                }
                onMeasured={(a) => setDepth(a.best ? a.best.rawCm + DEFAULT_ECHO_OFFSET_CM : null)}
              />
            </>
          )}
          <details>
            <summary className="small">Wall and base thickness</summary>
            <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label>
                Wall (cm)
                <input inputMode="decimal" value={wall} onChange={(e) => setWall(e.target.value)} />
              </label>
              <label>
                Base (cm)
                <input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
              </label>
            </div>
          </details>
        </div>
      )}

      {dims && (
        <div className="card stack">
          <h2>Inside dimensions</h2>
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
          <p className="muted small">
            Scale ±{(dims.scaleError * 100).toFixed(1)}%. With a card or sheet it's usually tighter;
            use that if this matters.
          </p>
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
        </div>
      )}
    </div>
  );
}

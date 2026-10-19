import { useEffect, useRef, useState } from 'react';

/**
 * Experimental: an AR tape measure on Android Chrome (ARCore) via WebXR hit-test. A ray
 * from the screen centre hits the detected surface; each screen tap drops a point there,
 * and pairs of points give a distance. Hidden where `immersive-ar` isn't supported (all of
 * iOS). Not yet tried on a real device.
 */

interface Vec {
  x: number;
  y: number;
  z: number;
}

// Minimal WebXR typings for what we use (the DOM lib doesn't ship them).
interface XRHitResult {
  getPose(space: unknown): { transform: { position: Vec } } | null;
}
interface XRFrameLike {
  session: XRSessionLike;
  getHitTestResults(source: unknown): XRHitResult[];
}
interface XRSessionLike extends EventTarget {
  requestReferenceSpace(type: string): Promise<unknown>;
  requestHitTestSource?(o: { space: unknown }): Promise<{ cancel(): void }>;
  updateRenderState(s: { baseLayer: unknown }): void;
  requestAnimationFrame(cb: (t: number, f: XRFrameLike) => void): number;
  end(): Promise<void>;
}
interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, opts: unknown): Promise<XRSessionLike>;
}

const xr = () => (navigator as Navigator & { xr?: XRSystemLike }).xr;
const cm = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100;

export function XrMeasure() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [aim, setAim] = useState<Vec | null>(null);
  const [points, setPoints] = useState<Vec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const session = useRef<XRSessionLike | null>(null);
  const aimRef = useRef<Vec | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Taps on the overlay's own buttons must not also drop a point.
  useEffect(() => {
    const el = panel.current;
    const stop = (e: Event) => e.preventDefault();
    el?.addEventListener('beforexrselect', stop);
    return () => el?.removeEventListener('beforexrselect', stop);
  });

  useEffect(() => {
    xr()
      ?.isSessionSupported('immersive-ar')
      .then(setSupported)
      .catch(() => setSupported(false));
    return () => void session.current?.end();
  }, []);

  if (!supported) return null;

  const start = async () => {
    setError(null);
    setPoints([]);
    try {
      const s = await xr()!.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: overlay.current },
      });
      session.current = s;
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', { xrCompatible: true }) as WebGLRenderingContext;
      const Layer = (window as unknown as { XRWebGLLayer: new (s: unknown, g: unknown) => unknown })
        .XRWebGLLayer;
      const layer = new Layer(s, gl) as { framebuffer: WebGLFramebuffer | null };
      s.updateRenderState({ baseLayer: layer });
      const local = await s.requestReferenceSpace('local');
      const viewer = await s.requestReferenceSpace('viewer');
      const source = await s.requestHitTestSource!({ space: viewer });
      const onFrame = (_t: number, frame: XRFrameLike) => {
        // The camera image is composited by the browser; we only clear our own layer.
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const hit = frame.getHitTestResults(source)[0];
        const pos = hit?.getPose(local)?.transform.position ?? null;
        aimRef.current = pos && { x: pos.x, y: pos.y, z: pos.z };
        setAim(aimRef.current);
        frame.session.requestAnimationFrame(onFrame);
      };
      s.requestAnimationFrame(onFrame);
      s.addEventListener('select', () => {
        const p = aimRef.current;
        if (p) setPoints((ps) => [...ps, p]);
      });
      s.addEventListener('end', () => {
        source.cancel();
        session.current = null;
        setActive(false);
      });
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pairs: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pairs.push(cm(points[i], points[i + 1]));
  const live = points.length % 2 === 1 && aim ? cm(points[points.length - 1], aim) : null;

  return (
    <div className="card stack">
      <h2>AR tape measure (experimental)</h2>
      <p className="muted small">
        This phone supports WebXR AR. Aim the centre cross at a point and tap to drop it; every two
        points give a distance. Measure the rim across the middle (inside to inside) and the height.
        Not yet tested on real devices, so check one against a tape measure.
      </p>
      <button className="block" onClick={start} disabled={active}>
        Start AR
      </button>
      {pairs.length > 0 && (
        <p className="mono">{pairs.map((d, i) => `#${i + 1}: ${d.toFixed(1)} cm`).join(' · ')}</p>
      )}
      {error && <p className="error">{error}</p>}
      <div ref={overlay} className={active ? 'xr-overlay on' : 'xr-overlay'}>
        <div className="xr-cross" />
        <div className="xr-panel" ref={panel}>
          <span className="mono">
            {aim ? (live != null ? `${live.toFixed(1)} cm` : 'tap to drop a point') : 'scanning…'}
          </span>
          {pairs.length > 0 && (
            <span className="mono small">
              {pairs.map((d, i) => `#${i + 1} ${d.toFixed(1)}`).join(' · ')} cm
            </span>
          )}
          <button className="small" onClick={() => session.current?.end()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

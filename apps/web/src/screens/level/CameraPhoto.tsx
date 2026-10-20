import { useState, type ReactNode } from 'react';
import { HowTo } from '../../components/howto/HowTo';
import { PhotoTapper, type TapResult, type TapStep } from '../../components/PhotoTapper';
import { api } from '../../lib/api';
import { useDebug } from '../../lib/debug';

/**
 * One photo for the camera screens: how-to, take or retake, tap the points, and (debug)
 * upload the photo with its taps as a fixture.
 */
export function Photo({
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

export function CardTooSmall() {
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

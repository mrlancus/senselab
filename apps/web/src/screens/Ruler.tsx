import { useState } from 'react';
import { DEFAULT_ECHO_OFFSET_CM } from '@senselab/dsp';
import { EchoCapture } from '../components/EchoCapture';
import { PhoneAtWallAnim } from '../components/howto/animations';
import { Link } from '../lib/router';

/** Sonar ruler: distance from the phone's bottom edge to a flat surface. */
export function Ruler() {
  const [history, setHistory] = useState<number[]>([]);
  return (
    <section className="stack">
      <div>
        <h1>📏 Sonar ruler</h1>
        <p className="muted">
          Distance to a wall or table from the phone's bottom edge, 10–130 cm, using its own chirps.
          Works best on big, flat, hard surfaces.
        </p>
      </div>
      <div className="card stack">
        <EchoCapture
          steps={[
            {
              art: <PhoneAtWallAnim />,
              title: 'Point the bottom edge at the surface',
              text: 'Square on, nothing else in between. Keep still while it pings (about a second).',
            },
          ]}
          minCm={10}
          maxCm={130}
          offsetCm={DEFAULT_ECHO_OFFSET_CM}
          labels={{ purpose: 'ruler' }}
          onMeasured={(a) => {
            const d = a.distanceCm;
            if (d != null) setHistory((h) => [d, ...h].slice(0, 6));
          }}
          renderResult={(a) => {
            if (a.distanceCm == null) return null;
            const d = a.distanceCm;
            return (
              <div className="stack" style={{ gap: 4 }}>
                <span className="big-number">{d.toFixed(1)} cm</span>
                <span className="muted mono small">
                  ± {Math.max(0.3, a.spreadCm + 0.2).toFixed(1)} cm · confidence{' '}
                  {(a.confidence * 100).toFixed(0)}%
                </span>
              </div>
            );
          }}
        />
        {history.length > 1 && (
          <p className="muted small mono">
            Earlier:{' '}
            {history
              .slice(1)
              .map((d) => d.toFixed(1))
              .join(' · ')}{' '}
            cm
          </p>
        )}
      </div>
      <p className="muted small">
        Accuracy: about ±0.5 cm on a wall at 20 °C. Set the air temperature for better than 1%
        (sound is 1.7% faster at 30 °C than at 20 °C). Soft furniture, curtains and angled surfaces
        return weak or misleading echoes.
      </p>
      <Link href="/">← All modes</Link>
    </section>
  );
}

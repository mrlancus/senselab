import type { ReactNode } from 'react';
import './howto.css';

export interface HowToStep {
  art: ReactNode;
  title: string;
  text: ReactNode;
}

/** Numbered instructions, each with a small looping animation of what to physically do. */
export function HowTo({ steps, compact = false }: { steps: HowToStep[]; compact?: boolean }) {
  return (
    <ol className={`howto ${compact ? 'compact' : ''}`}>
      {steps.map((s, i) => (
        <li key={i} className="howto-step">
          <div className="howto-art" aria-hidden>
            {s.art}
          </div>
          <div className="howto-text">
            <span className="howto-num">{i + 1}</span>
            <strong>{s.title}</strong>
            <span className="muted small">{s.text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

import { Link } from '../lib/router';
import { modes } from '../modes';

export function Home() {
  return (
    <section className="stack">
      <div className="hero">
        <h1>Your phone is a lab.</h1>
        <p className="muted">
          Measure the world with the speaker, microphone, motion sensors and camera you already
          carry.
        </p>
      </div>
      <ul className="mode-grid">
        {modes.map((m) => (
          <li key={m.path}>
            <Link href={m.path} className={`mode-card ${m.status}`}>
              <span className="mode-icon" aria-hidden>
                {m.icon}
              </span>
              <span className="mode-title">{m.title}</span>
              <span className="mode-blurb">{m.blurb}</span>
              {m.status === 'soon' && <span className="badge">Soon</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

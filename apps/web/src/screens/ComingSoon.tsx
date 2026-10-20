import { Link } from '../lib/router';
import type { ModeInfo } from '../modes';

export function ComingSoon({ mode }: { mode: ModeInfo }) {
  return (
    <section className="stack">
      <h1>
        {mode.icon} {mode.title}
      </h1>
      <p className="muted">{mode.blurb}</p>
      <div className="card">This mode is on the roadmap and not built yet.</div>
      <Link href="/">← All modes</Link>
    </section>
  );
}

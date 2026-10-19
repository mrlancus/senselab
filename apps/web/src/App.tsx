import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './lib/api';
import { setDebug, useDebug } from './lib/debug';
import { Link, match, usePath } from './lib/router';
import { modes } from './modes';
import { ComingSoon } from './screens/ComingSoon';
import { Home } from './screens/Home';
import { SensorCheck } from './screens/SensorCheck';

const screens: Record<string, () => ReactNode> = {
  '/sensor-check': () => <SensorCheck />,
};

export function App() {
  const path = usePath();
  const debug = useDebug();
  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          SenseLab
        </Link>
        {debug && (
          <button
            className="debug-badge"
            onClick={() => setDebug(false)}
            title="Turn debug views off"
          >
            DEBUG ✕
          </button>
        )}
      </header>
      <main className="content">{route(path)}</main>
      <Footer />
    </div>
  );
}

function route(path: string) {
  if (path === '/') return <Home />;
  for (const [pattern, render] of Object.entries(screens)) {
    if (match(pattern, path)) return render();
  }
  for (const m of modes) {
    if (match(m.path, path)) return <ComingSoon mode={m} />;
  }
  return (
    <section className="stack">
      <h1>Not found</h1>
      <Link href="/">Back home</Link>
    </section>
  );
}

function Footer() {
  const [version, setVersion] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const taps = useRef<number[]>([]);
  useEffect(() => {
    api
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => setOffline(true));
  }, []);
  // Five quick taps on the footer toggle the hidden debug views.
  const onTap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      setDebug(!document.querySelector('.debug-badge'));
    }
  };
  return (
    <footer className="footer" onClick={onTap}>
      {offline ? 'API offline' : version ? `v ${version}` : '…'} · audio stays on your device unless
      you choose to upload
    </footer>
  );
}

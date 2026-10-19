import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './lib/api';
import { setDebug, useDebug } from './lib/debug';
import { Link, match, usePath } from './lib/router';
import { modes } from './modes';
import { ComingSoon } from './screens/ComingSoon';
import { Home } from './screens/Home';
import { ContainerDetail } from './screens/level/ContainerDetail';
import { ContainerForm } from './screens/level/ContainerForm';
import { LevelHome } from './screens/level/LevelHome';
import { Ruler } from './screens/Ruler';
import { SensorCheck } from './screens/SensorCheck';

// First match wins, so literal paths go before parameterised ones.
const screens: [string, (p: Record<string, string>) => ReactNode][] = [
  ['/sensor-check', () => <SensorCheck />],
  ['/level', () => <LevelHome />],
  ['/level/new', () => <ContainerForm />],
  ['/level/:id/edit', (p) => <ContainerForm id={p.id} />],
  ['/level/:id', (p) => <ContainerDetail key={p.id} id={p.id!} />],
  ['/ruler', () => <Ruler />],
];

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
  for (const [pattern, render] of screens) {
    const params = match(pattern, path);
    if (params) return render(params);
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

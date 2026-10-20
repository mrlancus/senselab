import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { api } from './lib/api';
import { setDebug, useDebug } from './lib/debug';
import { Link, match, usePath } from './lib/router';
import { modes } from './modes';
import { ComingSoon } from './screens/ComingSoon';
import { Home } from './screens/Home';
// Each mode loads on demand (React.lazy), so the home screen doesn't wait for every mode's
// code. The service worker still precaches all chunks, so offline use is unchanged.
const named = <K extends string>(load: () => Promise<Record<K, ComponentType<never>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] as ComponentType<Record<string, unknown>> })));
const SensorCheck = named(() => import('./screens/SensorCheck'), 'SensorCheck');
const LevelHome = named(() => import('./screens/level/LevelHome'), 'LevelHome');
const ContainerForm = named(() => import('./screens/level/ContainerForm'), 'ContainerForm');
const ContainerDetail = named(() => import('./screens/level/ContainerDetail'), 'ContainerDetail');
const CameraMeasure = named(() => import('./screens/level/CameraMeasure'), 'CameraMeasure');
const Ruler = named(() => import('./screens/Ruler'), 'Ruler');
const Room = named(() => import('./screens/Room'), 'Room');
const Knock = named(() => import('./screens/Knock'), 'Knock');
const Metal = named(() => import('./screens/Metal'), 'Metal');
const Alerts = named(() => import('./screens/Alerts'), 'Alerts');
const Presence = named(() => import('./screens/Presence'), 'Presence');
const Temperature = named(() => import('./screens/Temperature'), 'Temperature');

// First match wins, so literal paths go before parameterised ones.
const screens: [string, (p: Record<string, string>) => ReactNode][] = [
  ['/sensor-check', () => <SensorCheck />],
  ['/level', () => <LevelHome />],
  ['/level/new', () => <ContainerForm />],
  ['/level/:id/edit', (p) => <ContainerForm id={p.id} />],
  ['/level/:id/camera', (p) => <CameraMeasure id={p.id!} view="dimensions" />],
  ['/level/:id/waterline', (p) => <CameraMeasure id={p.id!} view="waterline" />],
  ['/level/:id', (p) => <ContainerDetail key={p.id} id={p.id!} />],
  ['/ruler', () => <Ruler />],
  ['/room', () => <Room />],
  ['/knock', () => <Knock />],
  ['/metal', () => <Metal />],
  ['/alerts', () => <Alerts />],
  ['/presence', () => <Presence />],
  ['/temperature', () => <Temperature />],
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
      <main className="content">
        <Suspense fallback={<p className="muted">Loading…</p>}>{route(path)}</Suspense>
      </main>
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

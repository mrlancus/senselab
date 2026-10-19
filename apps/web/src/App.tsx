import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { Link, match, usePath } from './lib/router';
import { modes } from './modes';
import { Home } from './screens/Home';
import { ComingSoon } from './screens/ComingSoon';

export function App() {
  const path = usePath();
  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          SenseLab
        </Link>
      </header>
      <main className="content">{route(path)}</main>
      <Footer />
    </div>
  );
}

function route(path: string) {
  if (path === '/') return <Home />;
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
  useEffect(() => {
    api
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => setOffline(true));
  }, []);
  return (
    <footer className="footer">
      {offline ? 'API offline' : version ? `API ${version.slice(0, 7)}` : '…'} · audio stays on your
      device unless you choose to upload
    </footer>
  );
}

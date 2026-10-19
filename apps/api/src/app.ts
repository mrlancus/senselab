import { Hono } from 'hono';
import type { HealthResponse } from '@senselab/shared';
import type { AppEnv } from './env';
import { requireOwner } from './identity';
import { containers } from './routes/containers';
import { recordings } from './routes/recordings';

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/health', (c) =>
  c.json<HealthResponse>({ ok: true, service: 'senselab', version: c.env.APP_VERSION }),
);

app.use('/containers/*', requireOwner);
app.use('/recordings/*', requireOwner);
app.route('/containers', containers);
app.route('/recordings', recordings);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

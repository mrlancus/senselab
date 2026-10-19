import { Hono } from 'hono';
import {
  calibrationPointInputSchema,
  containerInputSchema,
  measurementInputSchema,
} from '@senselab/shared';
import { Repo } from '../db';
import type { AppEnv } from '../env';
import { parseJson } from '../validate';

export const containers = new Hono<AppEnv>();

const repo = (c: { env: AppEnv['Bindings']; get(k: 'ownerId'): string }) =>
  new Repo(c.env.DB, c.get('ownerId'));

containers.get('/', async (c) => c.json(await repo(c).listContainers()));

containers.post('/', async (c) => {
  const parsed = await parseJson(c, containerInputSchema);
  if (!parsed.ok) return parsed.response;
  return c.json(await repo(c).createContainer(parsed.data), 201);
});

containers.get('/:id', async (c) => {
  const r = repo(c);
  const container = await r.getContainer(c.req.param('id'));
  if (!container) return c.json({ error: 'Not found' }, 404);
  const [calibration, measurements] = await Promise.all([
    r.listCalibration(container.id),
    r.listMeasurements(container.id, 20),
  ]);
  return c.json({ ...container, calibration, measurements });
});

containers.put('/:id', async (c) => {
  const parsed = await parseJson(c, containerInputSchema);
  if (!parsed.ok) return parsed.response;
  const updated = await repo(c).updateContainer(c.req.param('id'), parsed.data);
  return updated ? c.json(updated) : c.json({ error: 'Not found' }, 404);
});

containers.delete('/:id', async (c) => {
  const ok = await repo(c).deleteContainer(c.req.param('id'));
  return ok ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
});

containers.get('/:id/calibration', async (c) => {
  const r = repo(c);
  if (!(await r.getContainer(c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
  return c.json(await r.listCalibration(c.req.param('id')));
});

containers.post('/:id/calibration', async (c) => {
  const r = repo(c);
  if (!(await r.getContainer(c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
  const parsed = await parseJson(c, calibrationPointInputSchema);
  if (!parsed.ok) return parsed.response;
  return c.json(await r.addCalibration(c.req.param('id'), parsed.data), 201);
});

containers.delete('/:id/calibration/:pointId', async (c) => {
  const ok = await repo(c).deleteCalibration(c.req.param('id'), c.req.param('pointId'));
  return ok ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
});

containers.get('/:id/measurements', async (c) => {
  const r = repo(c);
  if (!(await r.getContainer(c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
  return c.json(await r.listMeasurements(c.req.param('id')));
});

containers.post('/:id/measurements', async (c) => {
  const r = repo(c);
  if (!(await r.getContainer(c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
  const parsed = await parseJson(c, measurementInputSchema);
  if (!parsed.ok) return parsed.response;
  return c.json(await r.addMeasurement(c.req.param('id'), parsed.data), 201);
});

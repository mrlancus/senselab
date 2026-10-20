import { Hono } from 'hono';
import { exampleInputSchema, exampleModes, type ExampleMode } from '@senselab/shared';
import { Repo } from '../db';
import type { AppEnv } from '../env';
import { parseJson } from '../validate';

/** Labelled examples a mode learns from (knock features, taught alert sounds, fruit logs). */
export const examples = new Hono<AppEnv>();

const repo = (c: { env: AppEnv['Bindings']; get(k: 'ownerId'): string }) =>
  new Repo(c.env.DB, c.get('ownerId'));

const modeOf = (v: string | undefined): ExampleMode | null =>
  exampleModes.includes(v as ExampleMode) ? (v as ExampleMode) : null;

examples.get('/', async (c) => {
  const mode = modeOf(c.req.query('mode'));
  if (!mode) return c.json({ error: `mode must be one of ${exampleModes.join(', ')}` }, 400);
  return c.json(await repo(c).listExamples(mode));
});

examples.post('/', async (c) => {
  const parsed = await parseJson(c, exampleInputSchema);
  if (!parsed.ok) return parsed.response;
  return c.json(await repo(c).addExample(parsed.data), 201);
});

/** DELETE /examples?mode=knock&label=glass removes every example with that label. */
examples.delete('/', async (c) => {
  const mode = modeOf(c.req.query('mode'));
  const label = c.req.query('label');
  if (!mode || !label) return c.json({ error: 'mode and label are required' }, 400);
  return c.json({ deleted: await repo(c).deleteExampleLabel(mode, label) });
});

examples.delete('/:id', async (c) =>
  (await repo(c).deleteExample(c.req.param('id')))
    ? c.body(null, 204)
    : c.json({ error: 'Not found' }, 404),
);

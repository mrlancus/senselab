import { Hono } from 'hono';
import {
  MAX_RECORDING_BYTES,
  recordingLabelsSchema,
  recordingModes,
  type RecordingMode,
} from '@senselab/shared';
import { Repo } from '../db';
import type { AppEnv } from '../env';

/**
 * Opt-in debug uploads. Bytes stream straight from the request into a private R2 object
 * (no presigned URLs, so no R2 S3 credentials are needed); metadata goes to D1.
 * Downloads also go through the Worker, which checks ownership.
 */
export const recordings = new Hono<AppEnv>();

const allowedTypes = /^(audio|video|image)\/[\w.+-]+$|^application\/octet-stream$/;

const extensionFor = (type: string) =>
  ({
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  })[type.split(';')[0]!] ?? 'bin';

recordings.get('/', async (c) =>
  c.json(await new Repo(c.env.DB, c.get('ownerId')).listRecordings()),
);

recordings.post('/', async (c) => {
  const mode = c.req.query('mode') ?? 'other';
  if (!recordingModes.includes(mode as RecordingMode)) {
    return c.json({ error: `mode must be one of ${recordingModes.join(', ')}` }, 400);
  }
  const contentType = c.req.header('Content-Type') ?? '';
  if (!allowedTypes.test(contentType.split(';')[0]!)) {
    return c.json({ error: 'Content-Type must be audio/*, video/*, image/* or octet-stream' }, 415);
  }
  const length = Number(c.req.header('Content-Length'));
  if (!Number.isFinite(length) || length <= 0) {
    return c.json({ error: 'Content-Length required' }, 411);
  }
  if (length > MAX_RECORDING_BYTES) {
    return c.json({ error: `Recording larger than ${MAX_RECORDING_BYTES} bytes` }, 413);
  }

  let labels: unknown;
  try {
    labels = JSON.parse(c.req.query('labels') ?? '{}');
  } catch {
    return c.json({ error: 'labels must be JSON' }, 400);
  }
  const parsedLabels = recordingLabelsSchema.safeParse(labels);
  if (!parsedLabels.success) return c.json({ error: 'labels: invalid' }, 400);

  const sampleRateRaw = c.req.query('sampleRate');
  const sampleRate = sampleRateRaw ? Number(sampleRateRaw) : null;
  if (sampleRate !== null && !(sampleRate > 0 && sampleRate < 1e6)) {
    return c.json({ error: 'sampleRate invalid' }, 400);
  }

  const ownerId = c.get('ownerId');
  const id = crypto.randomUUID();
  const r2Key = `devices/${ownerId}/${mode}/${id}.${extensionFor(contentType)}`;
  const body = c.req.raw.body;
  if (!body) return c.json({ error: 'Empty body' }, 400);

  await c.env.RECORDINGS.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: { mode, ownerId },
  });
  const rec = await new Repo(c.env.DB, ownerId).addRecording({
    id,
    r2Key,
    mode,
    contentType,
    sizeBytes: length,
    sampleRate,
    labels: parsedLabels.data,
  });
  return c.json(rec, 201);
});

recordings.get('/:id', async (c) => {
  const rec = await new Repo(c.env.DB, c.get('ownerId')).getRecording(c.req.param('id'));
  if (!rec) return c.json({ error: 'Not found' }, 404);
  return c.json(rec);
});

recordings.get('/:id/data', async (c) => {
  const rec = await new Repo(c.env.DB, c.get('ownerId')).getRecording(c.req.param('id'));
  if (!rec) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.RECORDINGS.get(rec.r2Key);
  if (!obj) return c.json({ error: 'Object missing' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': rec.contentType,
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

recordings.delete('/:id', async (c) => {
  const repo = new Repo(c.env.DB, c.get('ownerId'));
  const rec = await repo.getRecording(c.req.param('id'));
  if (!rec) return c.json({ error: 'Not found' }, 404);
  await c.env.RECORDINGS.delete(rec.r2Key);
  await repo.deleteRecording(rec.key);
  return c.body(null, 204);
});

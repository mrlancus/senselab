import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_ID_HEADER, type Container } from '@senselab/shared';
import { app } from '../src/app';
import { testEnv } from './fakes';

const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';

let ctx: ReturnType<typeof testEnv>;

function call(path: string, init: RequestInit & { device?: string | null } = {}) {
  const headers = new Headers(init.headers);
  if (init.device !== null) headers.set(DEVICE_ID_HEADER, init.device ?? DEVICE_A);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return app.request(`/api${path}`, { ...init, headers }, ctx.env);
}

const bucket = {
  name: '10 L bucket',
  shape: { topDiameterCm: 28, bottomDiameterCm: 22, heightCm: 24 },
  material: 'plastic',
};

beforeEach(() => {
  ctx = testEnv();
});

describe('health', () => {
  it('needs no device id', async () => {
    const res = await call('/health', { device: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'senselab', version: 'test' });
  });
});

describe('identity', () => {
  it('rejects missing or malformed device ids', async () => {
    expect((await call('/containers', { device: null })).status).toBe(401);
    expect((await call('/containers', { device: 'nope' })).status).toBe(401);
  });

  it('isolates devices from each other', async () => {
    const created = (await (
      await call('/containers', { method: 'POST', body: JSON.stringify(bucket) })
    ).json()) as Container;
    const other = await call(`/containers/${created.id}`, { device: DEVICE_B });
    expect(other.status).toBe(404);
    expect(await (await call('/containers', { device: DEVICE_B })).json()).toEqual([]);
    const del = await call(`/containers/${created.id}`, { method: 'DELETE', device: DEVICE_B });
    expect(del.status).toBe(404);
  });
});

describe('containers', () => {
  it('creates, lists, updates and deletes', async () => {
    const res = await call('/containers', { method: 'POST', body: JSON.stringify(bucket) });
    expect(res.status).toBe(201);
    const c = (await res.json()) as Container;
    expect(c).toMatchObject(bucket);

    const list = (await (await call('/containers')).json()) as Container[];
    expect(list.map((x) => x.id)).toEqual([c.id]);

    const upd = await call(`/containers/${c.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...bucket, name: 'Blue bucket', shape: null }),
    });
    expect(await upd.json()).toMatchObject({ name: 'Blue bucket', shape: null });

    expect((await call(`/containers/${c.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/containers/${c.id}`)).status).toBe(404);
  });

  it('validates input', async () => {
    const bad = await call('/containers', {
      method: 'POST',
      body: JSON.stringify({ ...bucket, name: '' }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/^name/);
    const notJson = await call('/containers', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(notJson.status).toBe(400);
  });
});

describe('calibration and measurements', () => {
  it('stores points and measurements and cascades on delete', async () => {
    const c = (await (
      await call('/containers', { method: 'POST', body: JSON.stringify(bucket) })
    ).json()) as Container;
    for (const [litres, hz] of [
      [0, 820],
      [5, 610],
    ]) {
      const res = await call(`/containers/${c.id}/calibration`, {
        method: 'POST',
        body: JSON.stringify({
          method: 'tap',
          knownLitres: litres,
          measuredValue: hz,
          recordingKey: null,
        }),
      });
      expect(res.status).toBe(201);
    }
    const m = await call(`/containers/${c.id}/measurements`, {
      method: 'POST',
      body: JSON.stringify({
        method: 'tap',
        rawValue: 700,
        estimatedLitres: 2.9,
        confidence: 0.7,
        recordingKey: null,
      }),
    });
    expect(m.status).toBe(201);

    const detail = (await (await call(`/containers/${c.id}`)).json()) as {
      calibration: { knownLitres: number; id: string }[];
      measurements: unknown[];
    };
    expect(detail.calibration.map((p) => p.knownLitres)).toEqual([0, 5]);
    expect(detail.measurements).toHaveLength(1);

    const pid = detail.calibration[0]!.id;
    expect(
      (await call(`/containers/${c.id}/calibration/${pid}`, { method: 'DELETE', device: DEVICE_B }))
        .status,
    ).toBe(404);
    expect(
      (await call(`/containers/${c.id}/calibration/${pid}`, { method: 'DELETE' })).status,
    ).toBe(204);

    await call(`/containers/${c.id}`, { method: 'DELETE' });
    expect((await call(`/containers/${c.id}/calibration`)).status).toBe(404);
  });

  it('rejects calibration for unknown containers and bad methods', async () => {
    const body = JSON.stringify({
      method: 'tap',
      knownLitres: 1,
      measuredValue: 1,
      recordingKey: null,
    });
    expect((await call('/containers/nope/calibration', { method: 'POST', body })).status).toBe(404);
    const c = (await (
      await call('/containers', { method: 'POST', body: JSON.stringify(bucket) })
    ).json()) as Container;
    const bad = await call(`/containers/${c.id}/calibration`, {
      method: 'POST',
      body: JSON.stringify({
        method: 'camera',
        knownLitres: 1,
        measuredValue: 1,
        recordingKey: null,
      }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('recordings', () => {
  const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  const upload = (mode = 'tap', device = DEVICE_A) =>
    call(`/recordings?mode=${mode}&sampleRate=48000&labels=${encodeURIComponent('{"litres":6}')}`, {
      method: 'POST',
      body: wav,
      device,
      headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length) },
    });

  it('streams to R2, lists, downloads and deletes', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    const rec = (await res.json()) as { key: string; labels: unknown; sampleRate: number };
    expect(rec.labels).toEqual({ litres: 6 });
    expect(rec.sampleRate).toBe(48000);
    const [r2Key] = [...ctx.objects.keys()];
    expect(r2Key).toMatch(new RegExp(`^devices/${DEVICE_A}/tap/${rec.key}\\.wav$`));

    const data = await call(`/recordings/${rec.key}/data`);
    expect(new Uint8Array(await data.arrayBuffer())).toEqual(wav);
    expect((await call(`/recordings/${rec.key}/data`, { device: DEVICE_B })).status).toBe(404);

    expect((await call('/recordings')).status).toBe(200);
    expect((await call(`/recordings/${rec.key}`, { method: 'DELETE' })).status).toBe(204);
    expect(ctx.objects.size).toBe(0);
  });

  it('rejects bad modes, types and sizes', async () => {
    expect((await upload('zzz')).status).toBe(400);
    const wrongType = await call('/recordings?mode=tap', {
      method: 'POST',
      body: 'hi',
      headers: { 'Content-Type': 'text/html', 'Content-Length': '2' },
    });
    expect(wrongType.status).toBe(415);
    const huge = await call('/recordings?mode=tap', {
      method: 'POST',
      body: wav,
      headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(1e9) },
    });
    expect(huge.status).toBe(413);
  });
});

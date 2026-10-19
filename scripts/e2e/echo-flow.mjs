import { chromium } from 'playwright';
import { rmSync } from 'node:fs';
// Usage: python3 scripts/e2e/gen-echo.py OUT && node scripts/e2e/echo-flow.mjs OUT
// Needs `wrangler dev` (apps/api) on :8787 serving a fresh build, and Playwright + Chromium.
// Expected: wall ≈ 60.9 cm; bucket calibrated empty at raw ≈ 29.2 cm measures ≈ 7.4 L.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const profile = `${S}/chrome-profile-echo`;
rmSync(profile, { recursive: true, force: true });
const errors = [];

async function withMic(wav, fn) {
  const ctx = await chromium.launchPersistentContext(profile, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['microphone'],
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  try {
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

const ping = async (page) => {
  await page.getByRole('button', { name: /^Ping/ }).click();
  await page.getByRole('button', { name: 'Ping again' }).waitFor({ timeout: 20000 });
};

// 1. Free-air reference, recorded from the ruler screen (stored per device and band).
await withMic(`${S}/echo-free.wav`, async (page) => {
  await page.goto(`${BASE}/ruler?debug=1`);
  await page.getByRole('button', { name: 'Record reference' }).click();
  await page.getByRole('button', { name: 'Ping' }).waitFor({ timeout: 20000 });
  console.log('reference recorded');
});

// 2. Sonar ruler against a "wall".
await withMic(`${S}/echo-wall.wav`, async (page) => {
  await page.goto(`${BASE}/ruler?debug=1`);
  await ping(page);
  console.log('RULER', await page.locator('.big-number').innerText());
  await page.screenshot({ path: `${S}/ruler.png`, fullPage: true });
});

// 3. Bucket: create, calibrate empty by echo, then measure.
const url = await withMic(`${S}/echo-empty.wav`, async (page) => {
  await page.goto(`${BASE}/level`);
  await page.getByText('+ New container').click();
  await page.getByLabel('Name').fill('E2E echo bucket');
  await page.getByLabel('Top ⌀').fill('28');
  await page.getByLabel('Bottom ⌀').fill('22');
  await page.getByLabel('Height').fill('24');
  await page.getByRole('button', { name: 'Create container' }).click();
  await page.waitForURL(/\/level\/[0-9a-f-]{36}$/);
  const u = page.url();
  await page.goto(u + '?debug=1');
  await page.getByRole('tab', { name: /Echo/ }).click();
  await page.getByRole('tab', { name: 'Calibrate' }).click();
  await page.getByLabel('Litres in the container right now').fill('0');
  await ping(page);
  await page.getByRole('button', { name: 'Save as 0 L' }).click();
  await page.getByText('Saved: 0 L').waitFor();
  console.log('calibrated', await page.getByText('Saved: 0 L').innerText());
  return u;
});
await withMic(`${S}/echo-measure.wav`, async (page) => {
  await page.goto(url + '?debug=1');
  await page.getByRole('tab', { name: /Echo/ }).click();
  await page.getByRole('tab', { name: 'Measure' }).click();
  await ping(page);
  await page.getByRole('button', { name: 'Show litres' }).click();
  await page.locator('.result .big-number').waitFor();
  await page.waitForTimeout(1500);
  console.log('RESULT', (await page.locator('.result').innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: `${S}/echo-measure.png`, fullPage: true });
});
console.log('ERRORS', JSON.stringify(errors));

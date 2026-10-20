import { chromium } from 'playwright';
import { rmSync } from 'node:fs';
// Usage: python3 scripts/e2e/gen-taps.py OUT && node scripts/e2e/tap-flow.mjs OUT
// Needs `wrangler dev` (apps/api) on :8787 serving a fresh build, and Playwright + Chromium.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const profile = `${S}/chrome-profile`;
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

async function calibrate(page, url, litres) {
  await page.goto(url + '?debug=1');
  await page.getByRole('tab', { name: 'Calibrate' }).click();
  await page.getByLabel('Litres in the container right now').fill(String(litres));
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.getByRole('button', { name: `Save as ${litres} L` }).waitFor({ timeout: 20000 });
  const pitch = await page.locator('strong.mono').first().innerText();
  await page.getByRole('button', { name: `Save as ${litres} L` }).click();
  await page.getByText(`Saved: ${litres} L`).waitFor();
  console.log(`calibrated ${litres} L → ${pitch}`);
}

const url = await withMic(`${S}/tap-0.wav`, async (page) => {
  await page.goto(`${BASE}/level`);
  await page.getByText('+ New container').click();
  await page.getByLabel('Name').fill('E2E bucket');
  await page.getByLabel('Top ⌀').fill('28');
  await page.getByLabel('Bottom ⌀').fill('22');
  await page.getByLabel('Height').fill('24');
  await page.getByRole('button', { name: 'Create container' }).click();
  await page.waitForURL(/\/level\/[0-9a-f-]{36}$/);
  const u = page.url();
  await calibrate(page, u, 0);
  return u;
});
await withMic(`${S}/tap-5.wav`, (p) => calibrate(p, url, 5));
await withMic(`${S}/tap-10.wav`, (p) => calibrate(p, url, 10));
await withMic(`${S}/tap-7.5.wav`, async (page) => {
  await page.goto(url + '?debug=1');
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.getByRole('button', { name: 'Show litres' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Show litres' }).click();
  await page.locator('.big-number').waitFor();
  await page.waitForTimeout(1500);
  console.log('RESULT', (await page.locator('.result').innerText()).replace(/\n/g, ' | '));
  // The mic must be closed again once the measurement is done (no "in use" indicator).
  await page.waitForTimeout(1200);
  console.log('MIC OPEN AFTER', await page.evaluate(() => globalThis.__senselabAudio?.running));
  await page.screenshot({ path: `${S}/measure.png`, fullPage: true });
});
console.log('ERRORS', JSON.stringify(errors));

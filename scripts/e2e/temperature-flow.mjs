import { chromium } from 'playwright';
import { rmSync } from 'node:fs';
// Usage: python3 scripts/e2e/gen-echo.py OUT && python3 scripts/e2e/gen-temperature.py OUT &&
//        node scripts/e2e/temperature-flow.mjs OUT       (needs `wrangler dev` on :8787)
// Expected: ≈ 30 °C (± ~2 °C).
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const profile = `${S}/chrome-profile-temp`;
rmSync(profile, { recursive: true, force: true });
const errors = [];
async function withMic(wav, fn) {
  const ctx = await chromium.launchPersistentContext(profile, {
    viewport: { width: 390, height: 844 },
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
// One fake-mic file per browser launch: record the free-air reference (both cards should then
// offer Ping), then measure the near and the far spot from their own files.
await withMic(`${S}/echo-free.wav`, async (page) => {
  await page.goto(`${BASE}/temperature`);
  await page.getByRole('button', { name: 'Record reference' }).first().click();
  await page.getByRole('button', { name: 'Ping' }).first().waitFor({ timeout: 20000 });
  console.log(
    'reference recorded; cards with Ping:',
    await page.getByRole('button', { name: 'Ping' }).count(),
  );
});
const raw = {};
for (const spot of ['near', 'far']) {
  await withMic(`${S}/temp-${spot}.wav`, async (page) => {
    await page.goto(`${BASE}/temperature`);
    await page.getByRole('button', { name: 'Ping' }).first().click();
    await page.getByRole('button', { name: 'Ping again' }).first().waitFor({ timeout: 20000 });
    raw[spot] = await page.locator('.ok-note').first().innerText();
    console.log(spot, raw[spot]);
  });
}
// The two readings come from separate launches, so apply the app's formula here
// (temperatureFromBaseline, unit-tested) to cross-check the whole chain.
const r = (s) => parseFloat(s.match(/([\d.]+) cm/)[1]);
const c20 = 331.3 * Math.sqrt(1 + 20 / 273.15);
const c = (c20 * 100) / (r(raw.far) - r(raw.near));
console.log('TEMP', (((c / 331.3) ** 2 - 1) * 273.15).toFixed(1), '°C');
console.log('ERRORS', JSON.stringify(errors));

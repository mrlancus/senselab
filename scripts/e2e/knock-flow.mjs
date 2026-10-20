import { chromium } from 'playwright';
import { rmSync } from 'node:fs';
// Usage: python3 scripts/e2e/gen-knocks.py OUT && node scripts/e2e/knock-flow.mjs OUT
// Needs `wrangler dev` (apps/api) on :8787. Expected: identifies "wood"; melon ≈ 160 Hz.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const profile = `${S}/chrome-profile-knock`;
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

for (const kind of ['glass', 'wood', 'cardboard']) {
  await withMic(`${S}/knock-${kind}.wav`, async (page) => {
    await page.goto(`${BASE}/knock`);
    await page.getByRole('tab', { name: 'Teach' }).click();
    await page.getByLabel('What are you knocking on?').fill(kind);
    await page.getByRole('button', { name: 'Start listening' }).click();
    await page.getByText(/Saved \d+ knocks? as/).waitFor({ timeout: 20000 });
    console.log('TAUGHT', await page.getByText(/Saved \d+ knocks? as/).innerText());
  });
}
await withMic(`${S}/knock-wood.wav`, async (page) => {
  await page.goto(`${BASE}/knock?debug=1`);
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.locator('.big-number, .notice').first().waitFor({ timeout: 20000 });
  console.log(
    'IDENTIFY',
    (
      await page
        .locator('.card')
        .filter({ has: page.locator('.big-number') })
        .innerText()
    ).replace(/\n/g, ' | '),
  );
  await page.waitForTimeout(1200);
  console.log('MIC OPEN AFTER', await page.evaluate(() => globalThis.__senselabAudio?.running));
  await page.screenshot({ path: `${S}/knock.png`, fullPage: true });
});
await withMic(`${S}/knock-melon.wav`, async (page) => {
  await page.goto(`${BASE}/knock`);
  await page.getByRole('tab', { name: 'Fruit' }).click();
  await page.getByLabel('Which fruit').fill('melon #1');
  await page.getByLabel('Weight (kg)').fill('2');
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.locator('.big-number').waitFor({ timeout: 20000 });
  console.log(
    'FRUIT',
    (
      await page
        .locator('.card')
        .filter({ has: page.locator('.big-number') })
        .innerText()
    ).replace(/\n/g, ' | '),
  );
});
console.log('ERRORS', JSON.stringify(errors));

import { chromium } from 'playwright';
import { rmSync } from 'node:fs';
// Usage: python3 scripts/e2e/gen-alerts.py OUT && python3 scripts/e2e/gen-knocks.py OUT &&
//        node scripts/e2e/alerts-flow.mjs OUT          (needs `wrangler dev` on :8787)
// Expected: smoke alarm detected; taught doorbell detected; knocks trigger nothing.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const profile = `${S}/chrome-profile-alerts`;
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

const listen = async (page, seconds) => {
  await page.goto(`${BASE}/alerts?debug=1`);
  await page.getByRole('button', { name: 'Start listening' }).click();
  const flash = page.locator('.alert-flash strong');
  const got = await flash.waitFor({ timeout: seconds * 1000 }).then(
    () => flash.innerText(),
    () => null,
  );
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await page.waitForTimeout(1200);
  const mic = await page.evaluate(() => globalThis.__senselabAudio?.running);
  return { got, mic };
};

await withMic(`${S}/alert-doorbell.wav`, async (page) => {
  await page.goto(`${BASE}/alerts`);
  await page.getByLabel('Name').fill('doorbell');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByText(/Learned “doorbell”/).waitFor({ timeout: 20000 });
  console.log('TAUGHT', await page.getByText(/Learned “doorbell”/).innerText());
});
await withMic(`${S}/alert-smoke.wav`, async (page) =>
  console.log('SMOKE FILE →', JSON.stringify(await listen(page, 15))),
);
await withMic(`${S}/alert-doorbell.wav`, async (page) => {
  console.log('DOORBELL FILE →', JSON.stringify(await listen(page, 15)));
  await page.screenshot({ path: `${S}/alerts.png`, fullPage: true });
});
await withMic(`${S}/knock-glass.wav`, async (page) =>
  console.log('KNOCK FILE →', JSON.stringify(await listen(page, 10))),
);
console.log('ERRORS', JSON.stringify(errors));

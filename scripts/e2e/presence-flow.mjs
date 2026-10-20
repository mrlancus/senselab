import { chromium } from 'playwright';
// Usage: python3 scripts/e2e/gen-presence.py OUT && node scripts/e2e/presence-flow.mjs OUT
// Needs `wrangler dev` on :8787. Expected after ~25 s: "Someone still", "Breathing: ≈ 15 per
// minute | at ≈ 60 cm", and the mic closed after Stop.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const errors = [];
const ctx = await chromium.launchPersistentContext(`${S}/chrome-profile-presence`, {
  viewport: { width: 390, height: 844 },
  permissions: ['microphone'],
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${S}/presence-breathing.wav`,
  ],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto(`${BASE}/presence?debug=1`);
await page.getByRole('button', { name: 'Start sonar' }).click();
const breath = page.locator('strong', { hasText: 'Breathing:' });
await page
  .getByText(/per minute/)
  .waitFor({ timeout: 45000 })
  .catch(() => {});
console.log(
  'DEBUG',
  (
    await page
      .locator('details.debug pre')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' '),
);
console.log(
  'STATE',
  await page
    .locator('.big-number')
    .innerText()
    .catch(() => '—'),
);
console.log(
  'BREATH',
  await breath.innerText().catch(() => '—'),
  '|',
  await page
    .getByText(/rhythm .* dB above noise/)
    .innerText()
    .catch(() => ''),
);
await page.screenshot({ path: `${S}/presence.png`, fullPage: true });
await page.getByRole('button', { name: 'Stop' }).click();
await page.waitForTimeout(1200);
console.log('MIC OPEN AFTER', await page.evaluate(() => globalThis.__senselabAudio?.running));
await ctx.close();
console.log('ERRORS', JSON.stringify(errors));

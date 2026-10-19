import { chromium } from 'playwright';
// Usage: python3 scripts/e2e/gen-room.py OUT && node scripts/e2e/room-flow.mjs OUT
// Needs `wrangler dev` (apps/api) on :8787 serving a fresh build. Expected: RT60 ≈ 0.60 s.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const errors = [];
const ctx = await chromium.launchPersistentContext(`${S}/chrome-profile-room`, {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ['microphone'],
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${S}/room.wav`,
  ],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto(`${BASE}/room?debug=1`);
for (let i = 0; i < 3; i++) {
  await page.getByRole('button', { name: /Start listening|Clap again/ }).click();
  await page.getByRole('button', { name: /Clap again/ }).waitFor({ timeout: 20000 });
}
console.log('RESULT', await page.locator('.big-number').innerText());
console.log((await page.locator('table.numbers').first().innerText()).replace(/\t/g, ' '));
await page.screenshot({ path: `${S}/room.png`, fullPage: true });
await ctx.close();
console.log('ERRORS', JSON.stringify(errors));

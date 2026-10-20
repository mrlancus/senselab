import { chromium } from 'playwright';
// Usage: node scripts/e2e/metal-flow.mjs OUT   (needs `wrangler dev` on :8787)
// Headless Chromium has no compass, so this feeds synthetic deviceorientationabsolute +
// devicemotion events at 60 Hz: the phone turns ±25° while calibrating, keeps turning, and
// passes over "steel" (a 15° compass deflection the gyro doesn't see) at t = 7 s.
// Expected: "Nothing" before the steel, "Metal!" over it.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto(`${BASE}/metal?debug=1`);
/* global window, DeviceMotionEvent, DeviceOrientationEvent -- this callback runs in the page */
await page.evaluate(() => {
  const t0 = performance.now();
  const turn = (t) => 25 * Math.sin(1.3 * t);
  setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const rate = (turn(t + 1e-3) - turn(t - 1e-3)) / 2e-3;
    const bump = 15 * Math.exp(-(((t - 7) / 0.6) ** 2));
    const heading = (((200 + turn(t) + bump) % 360) + 360) % 360;
    window.dispatchEvent(
      new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: rate, beta: 0, gamma: 0 } }),
    );
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientationabsolute', {
        alpha: 360 - heading,
        beta: 0,
        gamma: 0,
        absolute: true,
      }),
    );
  }, 1000 / 60);
});
await page.getByRole('button', { name: 'Start' }).click();
const status = async () =>
  await page
    .locator('.big-number')
    .innerText()
    .catch(() => '—');
await page.waitForTimeout(5500);
console.log('AT 5.5 s', await status());
await page.waitForTimeout(1500);
console.log('AT 7 s', await status(), '|', await page.locator('.meter-label').innerText());
await page.screenshot({ path: `${S}/metal.png`, fullPage: true });
await page.waitForTimeout(2500);
console.log('AT 9.5 s', await status());
await browser.close();
console.log('ERRORS', JSON.stringify(errors));

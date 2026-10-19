import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
// Usage: python3 scripts/e2e/gen-photos.py OUT && node scripts/e2e/camera-flow.mjs OUT
// Needs `wrangler dev` (apps/api) on :8787 serving a fresh build.
// Expected: top 28.0, bottom ≈ 22, height 24.0 cm; waterline 14.0 cm ≈ 7.0 L.
const S = process.argv[2];
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const taps = JSON.parse(readFileSync(`${S}/photos.json`, 'utf8'));
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

/** Uploads a photo into the n-th photo card and taps its points in order. */
async function photo(n, file, view, order, manual = []) {
  const card = page
    .locator('.card')
    .filter({ has: page.getByText(/Take photo|Retake photo/) })
    .nth(n);
  await card.locator('input[type=file]').setInputFiles(`${S}/${file}`);
  const svg = card.locator('.tapper svg');
  await svg.waitFor();
  const [w] = taps[view].size;
  for (const key of order) {
    for (const [x, y] of taps[view][key] ?? []) {
      // Touch down at a whole CSS pixel (as a finger would), then drag 3× the remaining
      // offset: the tapper's fine-adjust moves the point at 1/3 speed.
      await svg.scrollIntoViewIfNeeded();
      const box = await svg.boundingBox();
      const tx = box.x + (x * box.width) / w;
      const ty = box.y + (y * box.width) / w;
      const sx = Math.round(tx);
      const sy = Math.round(ty);
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + 3 * (tx - sx), sy + 3 * (ty - sy));
      await page.mouse.up();
    }
    // Steps with an exact count advance by themselves; the others need Next (or Skip).
    if (manual.includes(key)) await card.getByRole('button', { name: /^(Next|Skip)$/ }).click();
  }
}

await page.goto(`${BASE}/level`);
await page.getByText('+ New container').click();
await page.getByLabel('Name').fill('E2E camera bucket');
await page.getByRole('button', { name: 'Create container' }).click();
await page.waitForURL(/\/level\/[0-9a-f-]{36}$/);
const url = page.url();

await page.goto(url + '/camera');
await photo(0, 'top.png', 'top', ['card', 'rim'], ['rim']);
console.log('TOP', await page.getByText(/Inside top ⌀/).innerText());
await photo(
  1,
  'side.png',
  'side',
  ['card', 'rimFront', 'baseFront', 'waterFront', 'top', 'bottom'],
  ['waterFront'],
);
console.log('SIDE', await page.getByText(/rim to base/).innerText());
console.log('DIMS', (await page.locator('dl.kv').innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${S}/camera.png`, fullPage: true });
await page.getByRole('button', { name: 'Save these dimensions' }).click();
await page.waitForURL(url);
console.log('SAVED', await page.locator('p.muted.small').first().innerText());

await page.goto(url + '/waterline');
await photo(0, 'side.png', 'side', ['card', 'baseFront', 'waterFront']);
console.log(
  'WATER',
  await page.locator('.big-number').innerText(),
  '|',
  await page.getByText(/cm deep/).innerText(),
);
await page.screenshot({ path: `${S}/waterline.png`, fullPage: true });
await browser.close();
console.log('ERRORS', JSON.stringify(errors));

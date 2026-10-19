// Renders apps/web/public/icon.svg to the PNG sizes the manifest needs.
// Usage: node scripts/render-icons.mjs  (needs Playwright + Chromium, dev-only)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const pub = join(import.meta.dirname, '..', 'apps', 'web', 'public');
const svg = readFileSync(join(pub, 'icon.svg'), 'utf8');
const outputs = [
  { file: 'icon-192.png', size: 192, pad: 0, bg: 'transparent' },
  { file: 'icon-512.png', size: 512, pad: 0, bg: 'transparent' },
  { file: 'icon-maskable-512.png', size: 512, pad: 56, bg: '#0f766e' },
  { file: 'apple-touch-icon.png', size: 180, pad: 0, bg: '#0f766e' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const o of outputs) {
  await page.setViewportSize({ width: o.size, height: o.size });
  const inner = o.size - o.pad * 2;
  await page.setContent(
    `<body style="margin:0;background:${o.bg};display:grid;place-items:center;height:100vh">
     <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`,
  );
  await page.screenshot({ path: join(pub, o.file), omitBackground: o.bg === 'transparent' });
}
await browser.close();

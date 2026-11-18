/**
 * Renders a brand template (HTML) to a PNG at an exact size, with the brand fonts loaded:
 *
 *   node marketing/scripts/render.ts marketing/templates/cover.html marketing/brand/exports/x.png 1500 500
 *
 * Run from the worktree root after `pnpm install` (it borrows the website's Playwright).
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [template, out, width, height] = process.argv.slice(2);
if (!template || !out || !width || !height) {
  console.error('usage: render.ts <template.html> <out.png> <width> <height>');
  process.exit(1);
}
const require = createRequire(resolve('apps/web/package.json'));
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
await page.goto(pathToFileURL(resolve(template)).href, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
});
await page.screenshot({ path: resolve(out) });
await browser.close();
console.log(`rendered ${out} (${width}x${height})`);

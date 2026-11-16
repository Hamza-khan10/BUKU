/**
 * Draws the site's share card (D-136): public/og/buku.png, 1200×630, the picture shown when a link
 * to BUKU is shared (WhatsApp, LinkedIn, X) or appears in search results.
 *
 * Drawn once, in the site's own font, and kept as a file: a static picture costs the Worker
 * nothing (Next's on-the-fly images carry only a thin fallback font). Redraw it after changing the
 * words or the brand, with the website running (`pnpm web`):
 *
 *   node apps/web/scripts/og-image.ts
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const site = process.env.OG_SITE ?? 'http://localhost:3000';
const out = fileURLToPath(new URL('../public/og/buku.png', import.meta.url));

const CARD = `
<div id="card" style="
  width:1200px;height:630px;box-sizing:border-box;padding:76px 84px;display:flex;flex-direction:column;
  justify-content:space-between;background:#011e14;color:#edf3f0;font-family:var(--font-instrument),sans-serif;
  position:relative;overflow:hidden">
  <div aria-hidden style="position:absolute;right:-180px;top:-220px;width:720px;height:720px;border-radius:50%;
    background:radial-gradient(closest-side,rgba(6,127,93,.55),rgba(6,127,93,0));"></div>
  <img src="/brand/buku-logo-reversed.svg" alt="" style="height:64px;width:auto;align-self:flex-start;position:relative">
  <div style="display:flex;flex-direction:column;gap:26px;position:relative">
    <div style="font-size:104px;line-height:.98;font-weight:650;letter-spacing:-.045em;font-stretch:96%">
      Book the time.<br><span style="color:#79d7b1">Skip the wait.</span>
    </div>
    <div style="font-size:34px;line-height:1.3;color:#b4c4bc;max-width:900px">
      Bookings and walk-in queues for barbers, clinics, salons and offices.
    </div>
  </div>
  <div style="font-size:30px;font-weight:600;color:#79d7b1;position:relative">onbuku.com</div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// The site's own page, so its font is loaded; then only the card is drawn on it.
await page.goto(`${site}/early-access`, { waitUntil: 'load' });
// Let the page finish coming to life (the development server may reload it once).
await page.waitForTimeout(3000);
// Laid over the page (not in place of it), so the page's own scripts leave it alone.
await page.evaluate((html) => {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
  layer.innerHTML = html;
  document.body.append(layer);
}, CARD);
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.querySelectorAll<HTMLImageElement>('#card img')].map((i) => i.decode()));
});
mkdirSync(fileURLToPath(new URL('../public/og/', import.meta.url)), { recursive: true });
await page.locator('#card').screenshot({ path: out });
await browser.close();
console.log(`og-image: ${out}`);

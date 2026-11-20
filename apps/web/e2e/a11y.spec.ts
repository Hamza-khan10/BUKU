import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { openBusiness, signIn } from './business-world';
import { closeBusiness } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, useTheme } from './helpers';

/**
 * What axe can't see (3.7g, D-141). axe reads every page's markup (expectAccessible, in the other
 * specs); these use the pages the way a person does:
 * - Tab through every control: each shows where the focus is (WCAG 2.4.7) and isn't hidden under
 *   the header or a bar (2.4.11). "Shows" is measured, not guessed: the control is photographed
 *   focused and not, and the two must differ (focus rings drawn by a wrapper count).
 * - The headings form an outline: one h1, no level skipped (1.3.1, 2.4.6).
 * - For people who ask for less motion, nothing on the page keeps moving (2.3.3, 2.2.2).
 * - Text survives wider letter, word, line and paragraph spacing without being cut off (1.4.12).
 */

const PAGES = [
  '/',
  '/how-it-works',
  '/for-business',
  '/pricing',
  '/categories',
  '/c/barbershop',
  '/explore',
  '/early-access',
  '/help',
  '/contact',
  '/about',
  '/legal/privacy',
  '/signin',
];

type Stop = {
  index: number;
  repeat: boolean;
  frame: boolean;
  name: string;
  box: { x: number; y: number; width: number; height: number } | null;
  hiddenUnder: string | null;
};

/** Where focus is now: its name, the box that shows it, and whether anything covers it all. */
function focusedStop(index: number): Stop | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return null;
  const describe = (n: Element) => {
    const text = (n.getAttribute('aria-label') ?? n.textContent ?? '').replace(/\s+/g, ' ').trim();
    const id = n.id ? `#${n.id}` : '';
    return `${n.tagName.toLowerCase()}${id} "${text.slice(0, 40)}"`;
  };
  const seen = el.dataset.a11yStop;
  if (seen !== undefined)
    return {
      index: Number(seen),
      repeat: true,
      frame: false,
      name: describe(el),
      box: null,
      hiddenUnder: null,
    };
  el.dataset.a11yStop = String(index);
  // The bot check's frame, and in development Next's own overlay: not the page's controls.
  if (el.tagName === 'IFRAME' || el.tagName === 'NEXTJS-PORTAL')
    return { index, repeat: false, frame: true, name: describe(el), box: null, hiddenUnder: null };

  // A visually hidden control (a radio drawn by its label) shows its focus on the label.
  let shown: Element = el;
  const own = el.getBoundingClientRect();
  if (own.width * own.height < 4) shown = (el as HTMLInputElement).labels?.[0] ?? el.closest('label') ?? el;
  // A link stretched over its card (an ::after laid over it) shows its focus around the card.
  const after = getComputedStyle(el, '::after');
  if (after.position === 'absolute' && after.content !== 'none' && el.offsetParent) shown = el.offsetParent;
  const r = shown.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Not hidden means at least one of five points on it shows the control itself (2.4.11).
  const inset = (a: number, b: number) => Math.min(4, (b - a) / 2);
  const points: [number, number][] = [
    [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
    [r.left + inset(r.left, r.right), r.top + inset(r.top, r.bottom)],
    [r.right - inset(r.left, r.right), r.top + inset(r.top, r.bottom)],
    [r.left + inset(r.left, r.right), r.bottom - inset(r.top, r.bottom)],
    [r.right - inset(r.left, r.right), r.bottom - inset(r.top, r.bottom)],
  ];
  let cover: Element | null = null;
  let visible = false;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit) continue;
    if (shown.contains(hit) || hit.contains(shown) || el.contains(hit)) {
      visible = true;
      break;
    }
    cover = hit;
  }
  const hiddenUnder = visible ? null : cover ? describe(cover) : 'outside the window';
  return {
    index,
    repeat: false,
    frame: false,
    name: describe(el),
    box: { x: r.x, y: r.y, width: r.width, height: r.height },
    hiddenUnder,
  };
}

/**
 * How two photos of the page differ: how many pixels, and what sits where they do (decoded in the
 * page, which already has a canvas). A handful at a glyph's edge is the browser re-drawing more
 * sharply after a scroll; motion moves hundreds.
 */
async function difference(page: Page, a: Buffer, b: Buffer): Promise<{ pixels: number; at: string }> {
  return page.evaluate(
    async ([A, B]) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((done) => {
          const img = new Image();
          img.onload = () => done(img);
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(A), load(B)]);
      const c = document.createElement('canvas');
      c.width = ia.width;
      c.height = ia.height;
      const x = c.getContext('2d')!;
      x.drawImage(ia, 0, 0);
      const da = x.getImageData(0, 0, c.width, c.height).data;
      x.clearRect(0, 0, c.width, c.height);
      x.drawImage(ib, 0, 0);
      const db = x.getImageData(0, 0, c.width, c.height).data;
      let pixels = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -1;
      let maxY = -1;
      for (let p = 0; p < da.length; p += 4) {
        if (da[p] === db[p] && da[p + 1] === db[p + 1] && da[p + 2] === db[p + 2]) continue;
        const k = p / 4;
        const px = k % c.width;
        const py = Math.floor(k / c.width);
        pixels++;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      const el = pixels
        ? document.elementFromPoint(
            (minX + maxX) / 2 / devicePixelRatio,
            (minY + maxY) / 2 / devicePixelRatio,
          )
        : null;
      const at = el ? `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')}` : 'nowhere';
      return { pixels, at };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

/** Tab through the page, up to `limit` controls; every problem found, by control. */
async function tabThrough(page: Page, limit: number): Promise<{ problems: string[]; stops: number }> {
  const problems: string[] = [];
  const viewport = page.viewportSize()!;
  let stops = 0;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    let stop = await page.evaluate(focusedStop, i);
    // A frame (the bot check) has its own controls: Tab on until focus is back on the page.
    for (let hops = 0; stop?.frame && hops < 8; hops++) {
      await page.keyboard.press('Tab');
      stop = await page.evaluate(focusedStop, i);
    }
    if (!stop || stop.repeat) break;
    if (stop.frame) continue;
    stops++;
    if (stop.hiddenUnder) {
      problems.push(`${stop.name}: hidden under ${stop.hiddenUnder}`);
      continue;
    }
    const b = stop.box!;
    // Rings sit a little outside what they mark (an outline's offset, a card's -inset-2).
    const x = Math.max(0, Math.floor(b.x - 12));
    const y = Math.max(0, Math.floor(b.y - 12));
    const clip = {
      x,
      y,
      width: Math.max(1, Math.min(viewport.width, Math.ceil(b.x + b.width + 12)) - x),
      height: Math.max(1, Math.min(viewport.height, Math.ceil(b.y + b.height + 12)) - y),
    };
    const focused = await page.screenshot({ clip, animations: 'disabled' });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const plain = await page.screenshot({ clip, animations: 'disabled' });
    if (focused.equals(plain)) problems.push(`${stop.name}: no visible focus`);
    // Back where it was, so the next Tab goes on from here.
    await page.locator(`[data-a11y-stop="${i}"]`).focus();
  }
  return { problems, stops };
}

test.describe('Accessibility beyond markup (3.7g)', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const path of PAGES) {
    test(`${path}: every control shows its focus and isn't hidden`, async ({
      page,
      context,
      baseURL,
      isMobile,
    }) => {
      test.setTimeout(90_000); // up to 70 controls, each photographed twice
      // Phones check the dark theme; computers the light one: both themes, both layouts.
      await useTheme(context, isMobile ? 'dark' : 'light', baseURL!);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { problems, stops } = await tabThrough(page, 70);
      expect(stops, 'the page has controls to reach').toBeGreaterThan(3);
      expect(problems).toEqual([]);
    });
  }

  test('headings form an outline on every page: one h1, no level skipped', async ({ page }) => {
    test.setTimeout(120_000); // many pages in one test
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Only headings that are rendered: while a page streams in, React holds the next part in a
      // hidden holder until it swaps it in, and nobody (eyes or screen reader) meets those.
      const levels = await page
        .locator('h1, h2, h3, h4, h5, h6')
        .evaluateAll((hs) =>
          hs
            .filter((h) => h.checkVisibility())
            .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').trim().slice(0, 40) })),
        );
      const ones = levels.filter((h) => h.level === 1).length;
      if (ones !== 1)
        problems.push(
          `${path}: ${ones} h1 (${levels
            .filter((h) => h.level === 1)
            .map((h) => `"${h.text}"`)
            .join(', ')})`,
        );
      levels.forEach((h, i) => {
        const before = i === 0 ? 1 : levels[i - 1]!.level;
        if (h.level > before + 1) problems.push(`${path}: h${before} → h${h.level} "${h.text}"`);
      });
    }
    expect(problems).toEqual([]);
  });

  test('with less motion asked for, nothing keeps moving', async ({ page }) => {
    test.setTimeout(180_000); // many pages in one test
    const problems: string[] = [];
    for (const path of ['/', '/how-it-works', '/for-business', '/pricing', '/early-access']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Not the site's own motion: Next's badge in development (it animates while compiling), and a
      // phone's overlay scrollbar, which shows while scrolling and fades a moment later.
      await page.addStyleTag({
        content:
          'nextjs-portal { display: none !important; } * { scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; }',
      });
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (const at of [0, 0.33, 0.66, 1]) {
        await page.evaluate((y) => window.scrollTo(0, y), Math.round(height * at));
        // Pictures that load as they come into view finish first; then the page must hold still.
        await page.waitForLoadState('networkidle');
        await page.evaluate(() =>
          Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))),
        );
        await page.waitForTimeout(600);
        // The bot check is Cloudflare's own frame, animating while it checks: not the page's motion.
        const frames = { mask: [page.locator('iframe')] };
        // Anything that changes meanwhile is written down, so a failure says what moved.
        await page.evaluate(() => {
          const w = window as unknown as { __changes: string[]; __watch?: MutationObserver };
          w.__changes = [];
          w.__watch?.disconnect();
          w.__watch = new MutationObserver((ms) => {
            for (const m of ms) {
              const t = m.target instanceof Element ? m.target : m.target.parentElement;
              // Playwright hides the text cursor for each photo by styling every field: not the page.
              if (m.attributeName === 'style' && t?.matches('input, textarea, [contenteditable]')) continue;
              const name = t ? `${t.tagName.toLowerCase()}.${[...t.classList].slice(0, 3).join('.')}` : '?';
              w.__changes.push(`${m.type} ${name}${m.attributeName ? ` [${m.attributeName}]` : ''}`);
            }
          });
          w.__watch.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
        });
        const first = await page.screenshot(frames);
        await page.waitForTimeout(1500);
        const second = await page.screenshot(frames);
        const changed = first.equals(second) ? null : await difference(page, first, second);
        if (changed && changed.pixels > 64) {
          const what = await page.evaluate(() => {
            const w = window as unknown as { __changes: string[] };
            const running = document
              .getAnimations()
              .filter((x) => x.playState === 'running')
              .map(
                (x) =>
                  `animation on ${(x.effect as KeyframeEffect | null)?.target?.className.toString().slice(0, 40) ?? '?'}`,
              );
            return (
              [...new Set([...w.__changes, ...running])].slice(0, 5).join('; ') ||
              'nothing in the page (a repaint)'
            );
          });
          problems.push(
            `${path} at ${Math.round(at * 100)}%: still moving (${changed.pixels} pixels around ${changed.at}; ${what})`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('text survives wider spacing without being cut off', async ({ page }) => {
    test.setTimeout(180_000); // many pages in one test
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.addStyleTag({
        content: `*:not(code):not(kbd) { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
                  p { margin-bottom: 2em !important; }`,
      });
      const cut = await page.evaluate(() => {
        // Each piece of visible text, against every edge that would clip it. Text inside a
        // scrolling area can be scrolled to; "…" on purpose and read-aloud-only text are fine.
        const found: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim();
          const el = n.parentElement;
          if (
            !text ||
            !el ||
            el.closest('[aria-hidden="true"], [data-illustration], script, style, noscript')
          )
            continue;
          if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
          range.selectNodeContents(n);
          const r = range.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
            const s = getComputedStyle(a);
            const scrolls = (v: string) => v === 'auto' || v === 'scroll';
            if (scrolls(s.overflowX) || scrolls(s.overflowY)) break;
            const clipsX = s.overflowX === 'hidden' || s.overflowX === 'clip';
            const clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
            if (!clipsX && !clipsY) continue;
            const b = a.getBoundingClientRect();
            if (b.width <= 2 || b.height <= 2) break;
            if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') break;
            const outX = clipsX && (r.left < b.left - 1 || r.right > b.right + 1);
            const outY = clipsY && (r.top < b.top - 1 || r.bottom > b.bottom + 1);
            if (outX || outY) {
              found.push(
                `"${text.slice(0, 40)}" cut by ${a.tagName.toLowerCase()}.${[...a.classList].slice(0, 4).join('.')}`,
              );
              break;
            }
          }
        }
        return found;
      });
      for (const c of cut) problems.push(`${path}: ${c}`);
    }
    expect(problems).toEqual([]);
  });

  test('on a phone, the workspace tabs at the bottom never cover the control with focus', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the bar is for phones');
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    test.setTimeout(120_000);
    const made: string[] = [];
    try {
      await signIn(page, `a11y.owner.${randomUUID()}@example.com`, 'Sana Iqbal', true);
      const place = await openBusiness(page, made, 'Focus Test');
      for (const where of ['settings', 'hours']) {
        await page.goto(`/business/${place.id}/${where}`);
        await page.waitForLoadState('networkidle');
        // The phone tabs (the last menu named after the business) are showing.
        await expect(page.getByRole('navigation', { name: 'Focus Test' }).last()).toBeVisible();
        const { problems, stops } = await tabThrough(page, 70);
        expect(stops).toBeGreaterThan(5);
        expect(problems, where).toEqual([]);
      }
    } finally {
      for (const id of made) closeBusiness(id);
    }
  });
});

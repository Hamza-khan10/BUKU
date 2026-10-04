import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable } from './helpers';

/**
 * Every page fits the screen: nothing makes a page scroll sideways, from a
 * 320 px phone up (WEB_PLAN §1: works from 320 px wide).
 */

const STATIC_PAGES = [
  '/',
  '/how-it-works',
  '/about',
  '/contact',
  '/help',
  '/security',
  '/legal',
  '/legal/privacy',
  '/legal/cookies',
  '/kit',
];
// Pages that need the API (pricing reads the plan catalog).
const DATA_PAGES = [
  '/explore',
  '/explore?q=hair',
  '/categories',
  '/c/barbershop',
  '/pricing',
  '/for-business',
];

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const width of [320, 390]) {
  test.describe(`At ${width} px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('pages don’t scroll sideways', async ({ page }) => {
      // Visits every page in turn: slow on a busy development server, so three times the usual time.
      test.slow();
      const pages = [...STATIC_PAGES];
      if (await apiAvailable()) {
        const api = process.env.E2E_API_URL ?? 'http://localhost:8000';
        const found = (await (await fetch(`${api}/v1/businesses/search?limit=1`)).json()) as {
          data: { slug: string }[];
        };
        pages.push(...DATA_PAGES, ...found.data.map((b) => `/b/${b.slug}`));
      }
      for (const path of pages) {
        // Loaded, fonts in (text width is final). Not "network idle": a business page keeps its
        // live queue stream open, so the network is never idle there.
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        expect([path, await overflow(page)]).toEqual([path, 0]);
      }
    });
  });
}

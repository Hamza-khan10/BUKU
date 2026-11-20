import { expect, test } from './fixtures';

/**
 * The home page's story, "Two ways to stop waiting" (D-095), loads light (3.7h): every visitor
 * gets the still version first, and it becomes the cinematic one (pinned, step by step as you
 * scroll) only once the visitor moves and comes near it, however near the top it sits; with less
 * motion asked for, it stays still.
 */

const story = '[aria-labelledby="how"]';
const scrollTo = (y: number) => (window as Window).scrollTo(0, y);

test.describe('The home page story', () => {
  test('still until the visitor moves and comes near, then plays step by step', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Loaded and not yet touched: the still version (no stage), whatever the page's length.
    await page.waitForTimeout(500);
    await expect(page.locator('[data-story-stage]')).toHaveCount(0);
    await expect(page.locator(`${story} li h3`)).toHaveCount(5);

    const top = await page.locator(story).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate(scrollTo, Math.max(0, top - 300));
    await expect(page.locator('[data-story-stage]')).toHaveCount(1);
    await expect(page.locator('[aria-current="step"] h3')).toContainText('Find a place');

    // Further down, the story moves on (the stage is pinned while the steps change).
    const stage = await page.locator(story).evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const screen = await page.evaluate(() => window.innerHeight);
    await page.evaluate(scrollTo, stage + screen * 2);
    await expect(page.locator('[aria-current="step"] h3')).not.toContainText('Find a place');
  });

  test('with less motion asked for, the five steps stay a still list', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator(story).scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-story-stage]')).toHaveCount(0);
    await expect(page.locator(`${story} li h3`)).toHaveText([
      /Find a place/,
      /Pick a free time/,
      /Get your ticket/,
      /Or take a number/,
      /Come in at your turn/,
    ]);
    await context.close();
  });
});

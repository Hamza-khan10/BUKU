import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectAccessible } from './helpers';

/**
 * What search and answer engines read (D-136): one address per page, a share card on every public
 * page, structured data that matches what people see, and /llms.txt.
 */

const structured = async (page: Page) =>
  (await page.locator('script[type="application/ld+json"]').allTextContents()).map(
    (t) => JSON.parse(t) as Record<string, unknown>,
  );

test.describe('Search and answer engines', () => {
  test('each public page has one address and its own share card, tags and all', async ({ page }) => {
    await page.goto('/early-access?source=instagram&utm_campaign=launch');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(new URL(canonical!).pathname).toBe('/early-access'); // the tags don't make a second page
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Get early access · BUKU',
    );
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(new URL(image!).pathname).toBe('/og/buku.png');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('meta[name="twitter:site"]')).toHaveAttribute('content', '@onbukuapp');
  });

  test('the share card is a real picture of the right size', async ({ request }) => {
    const res = await request.get('/og/buku.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    const png = await res.body();
    // PNG header: width and height are the 4-byte numbers at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  test('the home page says who runs the site, for engines', async ({ page }) => {
    await page.goto('/');
    const graph = (await structured(page)).flatMap((d) => (d['@graph'] as Record<string, unknown>[]) ?? []);
    expect(graph.map((n) => n['@type'])).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
  });

  test('businesses’ questions: the answers people can open are the ones engines read', async ({ page }) => {
    await page.goto('/for-business');
    const faq = (await structured(page)).find((d) => d['@type'] === 'FAQPage') as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(6);
    const section = page.getByRole('region', { name: 'Questions businesses ask.' });
    const [first, second, ...rest] = faq.mainEntity;
    // The first answer starts open, showing what the list does.
    await expect(section.getByText(first!.acceptedAnswer.text)).toBeVisible();
    for (const { name, acceptedAnswer } of [second!, ...rest]) {
      await expect(section.getByRole('button', { name })).toBeVisible();
      // In the page while closed (crawlers read it), hidden until opened.
      await expect(section.getByText(acceptedAnswer.text)).toBeAttached();
      await expect(section.getByText(acceptedAnswer.text)).toBeHidden();
    }
    // One open at a time: opening another closes the first.
    await section.getByRole('button', { name: second!.name }).click();
    await expect(section.getByText(second!.acceptedAnswer.text)).toBeVisible();
    await expect(section.getByText(first!.acceptedAnswer.text)).toBeHidden();
    await expectAccessible(page);
  });

  test('structured data carries the page’s nonce, like every script the server sends', async ({
    request,
  }) => {
    for (const path of ['/', '/for-business']) {
      const res = await request.get(path);
      const nonce = /'nonce-([^']+)'/.exec(res.headers()['content-security-policy'] ?? '')?.[1];
      const blocks = (await res.text()).match(/<script type="application\/ld\+json"[^>]*>/g) ?? [];
      expect(blocks.length, path).toBeGreaterThan(0);
      for (const tag of blocks) expect(tag, path).toContain(`nonce="${nonce}"`);
    }
  });

  test('llms.txt describes BUKU at its own address, with the same questions', async ({ request, page }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/markdown');
    const text = await res.text();
    expect(text).toMatch(/^# BUKU\n\n> /);
    await page.goto('/for-business');
    const firstQuestion = await page
      .getByRole('region', { name: 'Questions businesses ask.' })
      .getByRole('button')
      .first()
      .innerText();
    expect(text).toContain(`### ${firstQuestion.trim()}`);
  });
});

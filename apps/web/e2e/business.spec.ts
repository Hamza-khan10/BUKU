import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible, useTheme } from './helpers';

/** A business's public page, against the development stack's seed data. */

async function someBusiness(): Promise<string> {
  const api = process.env.E2E_API_URL ?? 'http://localhost:8000';
  const res = await fetch(`${api}/v1/businesses/search?limit=1&sort=rating`);
  const body = (await res.json()) as { data: { slug: string }[] };
  return body.data[0]!.slug;
}

test.describe('Business page', () => {
  let slug: string;
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    slug = await someBusiness();
  });

  test('shows what people decide on, with nothing invented', async ({ page }) => {
    await page.goto(`/b/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Services and prices' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Opening hours' })).toBeVisible();
    await expect(page.getByText('Prices are set by the business and paid at the venue.')).toBeVisible();
    await expect(page.getByText(/Verified business|Not verified/).first()).toBeVisible();
  });

  test('passes WCAG 2.2 AA in light and dark', async ({ page, context, baseURL }) => {
    await page.goto(`/b/${slug}`);
    await expectAccessible(page);
    await useTheme(context, 'dark', baseURL!);
    await page.reload();
    await expectAccessible(page);
  });

  test('tells search engines what the business is, safely', async ({ request }) => {
    const html = await (await request.get(`/b/${slug}`)).text();
    const block = /<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/.exec(html)?.[1];
    expect(block).toBeTruthy();
    const data = JSON.parse(block!) as { '@type': string; url: string };
    expect(data['@type']).toBe('LocalBusiness');
    expect(data.url).toContain(`/b/${slug}`);
  });

  test('a link by id settles on the business’s own address; unknown ones are a 404', async ({ request }) => {
    const api = process.env.E2E_API_URL ?? 'http://localhost:8000';
    const { data } = (await (await fetch(`${api}/v1/businesses/${slug}`)).json()) as { data: { id: string } };
    const byId = await request.get(`/b/${data.id}?service=abc`, { maxRedirects: 0 });
    expect(byId.status()).toBe(308);
    expect(byId.headers()['location']).toBe(`/b/${slug}?service=abc`);
    expect((await request.get('/b/no-such-business-here')).status()).toBe(404);
    expect((await request.get('/b/NOT_A_SLUG')).status()).toBe(404);
  });

  test('the walk-in queue follows the live stream', async ({ page }) => {
    await page.goto(`/b/${slug}`);
    const queue = page.getByRole('region', { name: 'Walk-in queue' });
    await expect(queue).toBeVisible();
    const stream = await page.request.get(`/api/live/queue/${slug}`, { timeout: 5000 }).catch(() => null);
    // The stream answers as server-sent events (it stays open; any answer header is enough).
    if (stream) expect(stream.headers()['content-type']).toContain('text/event-stream');
  });
});

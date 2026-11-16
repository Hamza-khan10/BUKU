import { randomBytes } from 'node:crypto';
import { expect, test, visitorAddress } from './fixtures';
import { expectAccessible, useTheme, watchForProblems } from './helpers';

/**
 * Early access (D-134): the list people and businesses join before BUKU opens. These run against
 * the in-memory store (EARLY_ACCESS_TEST_STORE, never on the live site) with no bot check; the
 * real store (D1) and the bot check have their own tests (test/early-access.test.ts).
 */

const email = (who: string) => `${who}.${randomBytes(4).toString('hex')}@example.com`;

test.describe('Early access', () => {
  test('a business joins: its details, its yes, and a clear “you’re on the list”', async ({ page }) => {
    const problems = await watchForProblems(page);
    const address = email('owner');
    await page.goto('/early-access?source=e2e');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Be first when BUKU opens.');
    // A business is who BUKU needs first: its form is the one that opens.
    await expect(page.getByRole('radio', { name: 'I run a business' })).toBeChecked();

    await page.getByLabel('Your name').fill('Hina Qureshi');
    await page.getByLabel('Business name').fill('Happy Tails Clinic');
    await page.getByLabel('What kind of business').fill('Veterinary clinic');
    await page.getByLabel('Branches').selectOption('2-5');
    await page.getByLabel('Email', { exact: true }).fill(address.toUpperCase());
    await page.getByLabel('WhatsApp number').fill('+92 300 123-4567');
    await page.getByLabel('City').fill('Lahore');
    await page.getByLabel('Which plan would you consider').selectOption('network');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Join the early-access list' }).click();

    const done = page.getByRole('status');
    await expect(done.getByRole('heading', { name: 'You’re on the list' })).toBeVisible();
    // The email as it's kept (lowercase), and the city the business named.
    await expect(done).toContainText(`We’ll email ${address} when BUKU opens in Lahore.`);
    await expect(done).toContainText('help you set up');
    expect(problems).toEqual([]);
  });

  test('the plan chosen on the pricing page comes along', async ({ page }) => {
    await page.goto('/early-access?as=business&plan=professional&source=pricing');
    await expect(page.getByLabel('Which plan would you consider')).toHaveValue('professional');
    await page.goto('/early-access?plan=<script>');
    await expect(page.getByLabel('Which plan would you consider')).toHaveValue('not_sure');
  });

  test('someone who books needs only an email, a city and their yes', async ({ page }) => {
    await page.goto('/early-access?as=customer');
    await expect(page.getByRole('radio', { name: 'I book appointments' })).toBeChecked();
    await expect(page.getByLabel('Business name')).toHaveCount(0);
    await expect(page.getByLabel('WhatsApp number')).toHaveCount(0);
    await page.getByLabel('Email', { exact: true }).fill(email('booker'));
    await page.getByLabel('City').fill('Karachi');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Join the early-access list' }).click();
    await expect(page.getByRole('heading', { name: 'You’re on the list' })).toBeVisible();
  });

  test('starts in the visitor’s own country, as the host tells it, and in Pakistan otherwise', async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'GB' });
    await page.goto('/early-access');
    await expect(page.getByLabel('Country')).toHaveValue('GB');
    await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'T1' }); // Tor: no country
    await page.goto('/early-access');
    await expect(page.getByLabel('Country')).toHaveValue('PK');
  });

  test('says what’s wrong in plain words, next to the field, before anything is sent', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/early-access')) sent.push(r.method());
    });
    await page.goto('/early-access');
    await page.getByLabel('Your name').fill('Hina 😀');
    await page.getByLabel('Business name').fill('X');
    await page.getByLabel('Email', { exact: true }).fill('not an email');
    await page.getByLabel('WhatsApp number').fill('0300-1234567');
    await page.getByRole('button', { name: 'Join the early-access list' }).click();

    await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Business name')).toHaveAccessibleDescription(/At least 2 characters/);
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('WhatsApp number')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Tick this')).toBeVisible();
    // The first field to fix gets the focus, and nothing went to the server.
    await expect(page.getByLabel('Your name')).toBeFocused();
    expect(sent).toEqual([]);
  });

  test('the same email twice gets the same answer (nobody can learn who joined)', async ({
    request,
    baseURL,
  }) => {
    const details = { kind: 'customer', email: email('twice'), city: 'Lahore', country: 'PK', consent: true };
    const send = () =>
      request.post('/api/early-access', {
        headers: { origin: baseURL!, 'x-buku-csrf': '1' },
        data: { details },
      });
    const first = await send();
    const again = await send();
    expect(first.status()).toBe(200);
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual(await first.json());
  });

  test('takes signups only from this site’s own page, and only well-formed ones', async ({
    request,
    baseURL,
  }) => {
    const details = { kind: 'customer', email: email('api'), city: 'Lahore', country: 'PK', consent: true };
    const post = (headers: Record<string, string>, data: unknown) =>
      request.post('/api/early-access', { headers, data });

    // Without the site's own header, or from another site: refused before anything is read.
    expect((await post({ origin: baseURL! }, { details })).status()).toBe(403);
    expect((await post({ origin: 'https://evil.example', 'x-buku-csrf': '1' }, { details })).status()).toBe(
      403,
    );
    const ours = { origin: baseURL!, 'x-buku-csrf': '1' };
    // Fields that aren't asked for, or a script for a tag: refused, with the field named.
    const bad = await post(ours, { details: { ...details, utmSource: '<script>', role: 'admin' } });
    expect(bad.status()).toBe(400);
    const body = (await bad.json()) as { error: { code: string; fields: Record<string, string> } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.error.fields)).toContain('utmSource');
    // Far more than a signup: refused unread.
    expect((await post(ours, { details: { ...details, city: 'x'.repeat(10_000) } })).status()).toBe(413);
  });

  test('five signups an hour from one place, then a polite no', async ({ playwright, baseURL }) => {
    const here = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-real-ip': visitorAddress(), origin: baseURL!, 'x-buku-csrf': '1' },
    });
    const join = () =>
      here.post('/api/early-access', {
        data: {
          details: { kind: 'customer', email: email('many'), city: 'Lahore', country: 'PK', consent: true },
        },
      });
    for (let i = 0; i < 5; i++) expect((await join()).status()).toBe(200);
    const sixth = await join();
    expect(sixth.status()).toBe(429);
    expect(((await sixth.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    await here.dispose();
  });

  test('the bot check’s script is allowed on this page only', async ({ request }) => {
    const csp = async (path: string) =>
      (await request.get(path, { maxRedirects: 0 })).headers()['content-security-policy'] ?? '';
    expect(await csp('/early-access')).toContain('https://challenges.cloudflare.com');
    expect(await csp('/')).not.toContain('challenges.cloudflare.com');
  });

  test('passes WCAG 2.2 AA, light and dark, both forms', async ({ page, context, baseURL }) => {
    await page.goto('/early-access');
    await expectAccessible(page);
    await useTheme(context, 'dark', baseURL!);
    await page.goto('/early-access?as=customer');
    await expectAccessible(page);
  });
});

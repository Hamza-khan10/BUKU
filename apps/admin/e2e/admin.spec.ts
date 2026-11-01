import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { API, apiAvailable, devSignIn, expect, expectAccessible, test, totp } from './helpers';
import { businessAskingForPlan, reportedReview } from './world';

/**
 * The admin app (D-091): its own sign-in, platform admins only, two-step
 * sign-in required before anything is shown, cookies of its own that no page
 * script can read, and nothing accepted from other sites.
 */

const newEmail = () => `operator.${randomUUID()}@example.com`;

test.describe('Admin app', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('signed out, every page goes to sign in; the sign-in page is plain and accessible', async ({
    page,
  }) => {
    for (const path of ['/', '/two-step']) {
      await page.goto(path);
      await expect(page).toHaveURL((url) => url.pathname === '/signin');
    }
    await expect(page.getByRole('heading', { name: 'Sign in to BUKU admin' })).toBeVisible();
    await expectAccessible(page);
    const robots = (await page.request.get('/signin')).headers()['x-robots-tag'];
    expect(robots).toContain('noindex');
  });

  test('a new admin must set up two-step sign-in first, then sees the console and the access review', async ({
    page,
    context,
  }) => {
    const email = newEmail();
    await devSignIn(page, email, 'Mariam Operator');
    await expect(page).toHaveURL((url) => url.pathname === '/two-step');
    // Nothing else is reachable until two-step sign-in is on.
    await page.goto('/');
    await expect(page).toHaveURL((url) => url.pathname === '/two-step');
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Set it up' }).click();
    const secret = (await page.getByLabel('Setup key').innerText()).replace(/\s+/g, '');
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('That code isn’t right');
    await page.getByLabel('6-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    await expect(page.getByRole('list', { name: 'Your recovery codes' }).getByRole('listitem')).toHaveCount(
      10,
    );
    await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.getByLabel('I’ve saved my recovery codes somewhere safe').check();
    await page.getByRole('button', { name: 'Done' }).click();

    // The console (3.6b): the overview first, then the access review under Security.
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Waiting for a decision' })).toBeVisible();
    await expectAccessible(page);
    await page
      .getByRole('navigation', { name: 'Console' })
      .getByRole('link', { name: 'Access review' })
      .click();
    await expect(page.getByRole('heading', { name: 'Access review' })).toBeVisible();
    const me = page.getByRole('row').filter({ hasText: email });
    await expect(me).toContainText('On');
    await expectAccessible(page);

    // The session lives in this app's own HttpOnly cookies; page scripts see no token.
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['buku_admin_at', 'buku_admin_rt', 'buku_admin_s']));
    expect(names.some((n) => /^(__Host-)?buku_(at|rt|s)$/.test(n))).toBe(false);
    for (const c of await context.cookies()) {
      if (/buku_admin_(at|rt)$/.test(c.name)) expect(c.httpOnly).toBe(true);
    }
    expect(await page.evaluate(() => /buku_admin_(at|rt)=/.test(document.cookie))).toBe(false);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/signin');
    expect((await context.cookies()).some((c) => c.name === 'buku_admin_at')).toBe(false);
  });

  test('a customer’s account is refused here, and gets no session', async ({ page, context }) => {
    const email = newEmail();
    // A customer, made the way the website makes them.
    const made = await fetch(`${API}/v1/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Just A Customer' }),
    });
    expect(made.ok).toBe(true);

    await devSignIn(page, email, 'Just A Customer');
    await expect(page.getByRole('main').getByRole('alert')).toContainText('isn’t a BUKU platform admin');
    await expect(page).toHaveURL((url) => url.pathname === '/signin');
    expect((await context.cookies()).filter((c) => c.name.startsWith('buku_admin'))).toEqual([]);
  });

  test('without the admin app’s own Google client, Google isn’t offered and its endpoints say so', async ({
    page,
    request,
  }) => {
    // Whether this admin app has its own Google client is what its sign-in page offers.
    const configured = (await (await request.get('/signin')).text()).includes('Continue with Google');
    test.skip(configured, 'Google is set up for this admin app');
    await page.goto('/signin');
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
    for (const path of ['/api/auth/google/start', '/api/auth/google/callback?code=x&state=y']) {
      await page.goto(path);
      await expect(page).toHaveURL(
        (url) => url.pathname === '/signin' && url.searchParams.get('error') === 'google-unavailable',
      );
      await expect(page.getByRole('main').getByRole('alert')).toContainText('isn’t available right now');
    }
  });

  test('with its own Google client: the way to Google is this app’s, and a return it didn’t start is refused', async ({
    request,
    baseURL,
  }) => {
    const configured = (await (await request.get('/signin')).text()).includes('Continue with Google');
    test.skip(!configured, 'Google isn’t set up for this admin app');
    const start = await request.get('/api/auth/google/start', { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    const google = new URL(start.headers()['location']!);
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('redirect_uri')).toBe(
      `${new URL(baseURL!).origin}/api/auth/google/callback`,
    );
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('state')).toBeTruthy();
    // A return from Google that this browser never started: refused, nothing set.
    const back = await request.get('/api/auth/google/callback?code=x&state=not-ours', {
      maxRedirects: 0,
      headers: { cookie: '' },
    });
    expect(back.status()).toBe(303);
    expect(new URL(back.headers()['location']!, 'http://x').searchParams.get('error')).toBe('google-expired');
  });

  test('calls from other sites are refused, and the admin API is closed to everyone else', async ({
    page,
    baseURL,
  }) => {
    const res = await page.request.post('/api/auth/dev', {
      headers: { 'x-buku-csrf': '1', origin: 'https://evil.example', 'content-type': 'application/json' },
      data: { email: newEmail() },
    });
    expect(res.status()).toBe(403);
    const noHeader = await page.request.post('/api/auth/dev', {
      headers: { origin: new URL(baseURL!).origin, 'content-type': 'application/json' },
      data: { email: newEmail() },
    });
    expect(noHeader.status()).toBe(403);
    // Straight at the gateway, without the admin app's key, admin routes don't exist.
    expect((await fetch(`${API}/v1/admin/access-review`)).status).toBe(404);
    expect((await fetch(`${API}/v1/admin/switches`)).status).toBe(404);
  });

  test('an emergency switch: turned off with a reason, obeyed by the API, shown on the overview, turned back on', async ({
    page,
    context,
  }) => {
    await newOperator(page);
    await page
      .getByRole('navigation', { name: 'Console' })
      .getByRole('link', { name: 'Emergency switches' })
      .click();
    await expect(page.getByRole('heading', { name: 'Emergency switches', level: 1 })).toBeVisible();
    await expectAccessible(page);
    const uploads = page
      .getByRole('list', { name: 'Switches' })
      .getByRole('listitem')
      .filter({ hasText: 'Uploading pictures and documents' });
    await expect(uploads).toContainText('On');

    await uploads.getByRole('button', { name: 'Turn off (Uploads)' }).click();
    await uploads.getByLabel(/Why turn it off\?/).fill('e2e: checking the switch');
    await uploads.getByRole('button', { name: 'Turn off', exact: true }).click();
    try {
      await expect(uploads.getByRole('button', { name: 'Turn back on (Uploads)' })).toBeVisible();
      await expect(uploads).toContainText('“e2e: checking the switch”');
      await expect(page.getByRole('alert').filter({ hasText: 'Off now: Uploads' })).toBeVisible();
      await expectAccessible(page);

      // The API refuses an upload at once, saying only that it's paused.
      const token = (await context.cookies()).find((c) => c.name === 'buku_admin_at')?.value;
      expect(token).toBeTruthy();
      const refused = await fetch(`${API}/v1/auth/me/avatar/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(refused.status).toBe(503);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('SERVICE_PAUSED');

      await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Overview' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Turned off: Uploads' })).toBeVisible();
      await page
        .getByRole('navigation', { name: 'Console' })
        .getByRole('link', { name: 'Emergency switches' })
        .click();
    } finally {
      await uploads.getByRole('button', { name: 'Turn back on (Uploads)' }).click();
    }
    await expect(uploads.getByRole('button', { name: 'Turn off (Uploads)' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Everything is on' })).toBeVisible();
  });

  test('an account: found by email, suspended with a reason (its access stops at once), reinstated', async ({
    page,
  }) => {
    const email = newEmail();
    const made = await fetch(`${API}/v1/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Kamran Customer' }),
    });
    expect(made.ok).toBe(true);
    const customerToken = ((await made.json()) as { data: { accessToken: string } }).data.accessToken;
    const me = () => fetch(`${API}/v1/auth/me`, { headers: { authorization: `Bearer ${customerToken}` } });
    expect((await me()).status).toBe(200);

    await newOperator(page);
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Accounts' }).click();
    await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();
    await expectAccessible(page);

    await page.getByLabel('Email or account ID').fill(newEmail());
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'No account has that email or ID.' }),
    ).toBeVisible();

    await page.getByLabel('Email or account ID').fill(email);
    await page.getByRole('button', { name: 'Find' }).click();
    const card = page.getByRole('region', { name: 'Account: Kamran Customer' });
    await expect(card).toContainText('Active');
    await expect(card).toContainText(email);
    // The email stays out of the address bar.
    expect(page.url()).not.toContain('example.com');
    await expectAccessible(page);

    await card.getByRole('button', { name: 'Suspend (Kamran Customer)' }).click();
    await card.getByLabel(/Why suspend this account\?/).fill('e2e: checking suspension');
    await card.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expect(card).toContainText('Suspended');
    await expect(card).toContainText('0 devices');
    expect((await me()).status).toBe(401);

    await card.getByRole('button', { name: 'Reinstate (Kamran Customer)' }).click();
    await expect(card).toContainText('Active');
    await expect(card.getByRole('button', { name: 'Suspend (Kamran Customer)' })).toBeVisible();
  });

  test('the audit log: a suspension is on the account’s activity and in the log, with its reason', async ({
    page,
  }) => {
    const email = newEmail();
    const made = await fetch(`${API}/v1/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Ayesha Audit' }),
    });
    expect(made.ok).toBe(true);

    await newOperator(page);
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Accounts' }).click();
    await page.getByLabel('Email or account ID').fill(email);
    await page.getByRole('button', { name: 'Find' }).click();
    const card = page.getByRole('region', { name: 'Account: Ayesha Audit' });
    await card.getByRole('button', { name: 'Suspend (Ayesha Audit)' }).click();
    await card.getByLabel(/Why suspend this account\?/).fill('e2e: audit trail');
    await card.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expect(card).toContainText('Suspended');

    // The account's own activity: what was done to it, and by whom.
    await card.getByRole('button', { name: 'Show their activity' }).click();
    await expect(card.getByRole('listitem').filter({ hasText: 'suspended this account' })).toContainText(
      '“e2e: audit trail”',
    );

    // The log: the same step, as the admin's, under Accounts.
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Kind of step' })
      .getByRole('link', { name: 'Accounts' })
      .click();
    const step = page
      .getByRole('region', { name: 'Steps' })
      .getByRole('listitem')
      .filter({ hasText: 'You suspended an account' })
      .filter({ hasText: 'Ayesha Audit' });
    await expect(step).toContainText('“e2e: audit trail”');
    await expectAccessible(page);

    // Reinstated, to leave the account as it was.
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Accounts' }).click();
    await page.getByLabel('Email or account ID').fill(email);
    await page.getByRole('button', { name: 'Find' }).click();
    await page
      .getByRole('region', { name: 'Account: Ayesha Audit' })
      .getByRole('button', { name: 'Reinstate (Ayesha Audit)' })
      .click();
    await expect(page.getByRole('region', { name: 'Account: Ayesha Audit' })).toContainText('Active');
  });

  test('a reported review: read, hidden with a reason (gone from the business’s page), put back', async ({
    page,
  }) => {
    const reported = await reportedReview();
    test.skip(!reported, 'the development database isn’t reachable to set the review up');
    const { business, comment } = reported!;
    const publicReviews = async () =>
      (await (await fetch(`${API}/v1/businesses/${business.slug}/reviews?limit=50`)).json()) as {
        data: { comment: string | null }[];
      };
    expect((await publicReviews()).data.some((r) => r.comment === comment)).toBe(true);

    await newOperator(page);
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Reviews' }).click();
    await expect(page.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible();
    const item = page
      .getByRole('list', { name: 'Reviews' })
      .getByRole('listitem')
      .filter({ hasText: comment });
    await expect(item).toContainText('Fake review');
    await expect(item).toContainText('“No booking at that time”');
    await expect(item).toContainText('1 of 5');
    await expectAccessible(page);

    await item.getByRole('button', { name: /^Hide \(/ }).click();
    await item.getByLabel(/Why hide it\?/).fill('e2e: not a real visit');
    await item.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(item).toHaveCount(0);
    expect((await publicReviews()).data.some((r) => r.comment === comment)).toBe(false);

    await page
      .getByRole('navigation', { name: 'Which reviews' })
      .getByRole('link', { name: 'Hidden' })
      .click();
    const hidden = page
      .getByRole('list', { name: 'Reviews' })
      .getByRole('listitem')
      .filter({ hasText: comment });
    await expect(hidden).toContainText('“e2e: not a real visit”');
    await hidden.getByRole('button', { name: /^Put it back \(/ }).click();
    await expect(hidden).toHaveCount(0);
    expect((await publicReviews()).data.some((r) => r.comment === comment)).toBe(true);

    // Both steps are in the audit log, as this admin's.
    await page.goto('/security/audit?area=reviews&days=1');
    const steps = page.getByRole('region', { name: 'Steps' });
    await expect(steps.getByRole('listitem').filter({ hasText: 'You hid a review' }).first()).toContainText(
      '“e2e: not a real visit”',
    );
    await expect(
      steps.getByRole('listitem').filter({ hasText: 'You put a hidden review back' }).first(),
    ).toBeVisible();
  });

  test('billing: a plan request approved free until a date, then the plan ended; both in the audit log', async ({
    page,
  }) => {
    const business = await businessAskingForPlan();
    await newOperator(page);
    await page.getByRole('navigation', { name: 'Console' }).getByRole('link', { name: 'Billing' }).click();
    await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
    const request = page
      .getByRole('list', { name: 'Plan requests' })
      .getByRole('listitem')
      .filter({ hasText: business.message });
    await expect(request).toContainText(business.name);
    await expect(request).toContainText('Enterprise');
    await expectAccessible(page);

    await request.getByRole('button', { name: `Approve… (${business.name})` }).click();
    const until = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    await request.getByLabel(/Free until/).fill(until);
    await request.getByLabel(/Note for the record/).fill('e2e: pilot for a quarter');
    await request.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(request).toHaveCount(0);

    // The plan is theirs: under Subscriptions, given by an admin, until that day.
    await page
      .getByRole('navigation', { name: 'Billing' })
      .getByRole('link', { name: 'Subscriptions' })
      .click();
    const row = page.getByRole('row').filter({ hasText: business.name });
    await expect(row).toContainText('Enterprise');
    await expect(row).toContainText('Given by an admin');
    await expectAccessible(page);
    await row.getByRole('button', { name: /^End now \(/ }).click();
    await row.getByLabel(/Why end it\?/).fill('e2e: pilot over');
    await row.getByRole('button', { name: 'End now', exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole('navigation', { name: 'By status' }).getByRole('link', { name: 'Ended' }).click();
    await expect(page.getByRole('row').filter({ hasText: business.name })).toContainText('Ended');

    await page.goto('/security/audit?area=billing&days=1');
    const steps = page.getByRole('region', { name: 'Steps' });
    await expect(
      steps.getByRole('listitem').filter({ hasText: 'You approved a plan request' }).first(),
    ).toContainText('“e2e: pilot for a quarter”');
    await expect(
      steps.getByRole('listitem').filter({ hasText: 'You ended a subscription' }).first(),
    ).toContainText('“e2e: pilot over”');
  });

  test('plans and prices: what each plan includes and costs; a settings change saved and put back', async ({
    page,
  }) => {
    await newOperator(page);
    await page.goto('/billing?view=plans');
    const plans = page.getByRole('list', { name: 'Business plans' });
    const essential = plans.getByRole('listitem').filter({ hasText: 'business_essential' });
    await expect(essential).toContainText('Team logins');
    await expect(essential).toContainText('Website (Paddle)');
    await expect(essential.getByRole('button', { name: 'New price… (Essential)' })).toBeVisible();
    await expectAccessible(page);

    // Stopping a sale asks first, and can be called off.
    await essential.getByRole('button', { name: /^Stop selling the plan \(/ }).click();
    await expect(essential).toContainText('New businesses can’t choose it');
    await essential.getByRole('button', { name: 'Keep it' }).click();
    await expect(essential).not.toContainText('New businesses can’t choose it');

    // The trial's length: changed, saved, still there after a reload, then put back.
    const days = page.getByLabel('Trial length (days)');
    const before = await days.inputValue();
    const changed = String(Number(before) === 365 ? 364 : Number(before) + 1);
    await days.fill(changed);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Trial length (days)')).toHaveValue(changed);
    await page.getByLabel('Trial length (days)').fill(before);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  });
});

/** A new platform admin with two-step sign-in set up, on the overview. */
async function newOperator(page: Page) {
  await devSignIn(page, newEmail(), 'Sana Operator');
  await expect(page).toHaveURL((url) => url.pathname === '/two-step');
  await page.getByRole('button', { name: 'Set it up' }).click();
  const secret = (await page.getByLabel('Setup key').innerText()).replace(/\s+/g, '');
  await page.getByLabel('6-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await page.getByLabel('I’ve saved my recovery codes somewhere safe').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
}

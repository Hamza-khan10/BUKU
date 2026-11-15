import { randomUUID } from 'node:crypto';
import { customerBooks, openBusiness, signIn } from './business-world';
import { canSimulateTime, closeBusiness, visitHappened } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

/**
 * The business's reviews (3.5i): what customers wrote, a reply (changed, removed), and a report
 * for BUKU's moderators. Against the development stack.
 */

const made: string[] = [];

test.describe('The business’s reviews', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    test.skip(!canSimulateTime(), 'the development database is not reachable');
  });
  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('read a review, reply to it, change the reply, then report it', async ({ page, browser, baseURL }) => {
    test.setTimeout(90_000);
    await signIn(page, `reviews.owner.${randomUUID()}@example.com`, 'Hina Qureshi', true);
    const place = await openBusiness(page, made, 'Reviews Test');
    const visit = await customerBooks(browser, baseURL!, place, 'Bilal Raza');
    expect(visitHappened(place.id, visit.id)).toBe(true);
    const comment = `Waited forty minutes past my time (${randomUUID().slice(0, 6)})`;
    const posted = await visit.page.request.post(`/api/v1/appointments/${visit.id}/review`, {
      headers: { 'x-buku-csrf': '1', origin: new URL(baseURL!).origin },
      data: { overall: 2, comment },
    });
    expect(posted.ok(), await posted.text()).toBe(true);
    await visit.close();

    await page.goto(`/business/${place.id}/reviews`);
    await expect(page.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible();
    const card = page.getByRole('listitem', { name: 'Review by Bilal R.' });
    await expect(card).toContainText(comment);
    await expect(page.getByRole('tab', { name: /Not replied/ })).toContainText('1');
    await expectAccessible(page);

    await card.getByRole('button', { name: 'Reply to Bilal R.' }).click();
    await card.getByLabel(/Your reply/).fill('Sorry about the wait, Bilal. We have added a second chair.');
    await card.getByRole('button', { name: 'Post the reply' }).click();
    await expect(card).toContainText('We have added a second chair.');
    await expect(page.getByRole('tab', { name: /Not replied/ })).not.toContainText('1');

    await card.getByRole('button', { name: 'Change the reply to Bilal R.' }).click();
    await card.getByLabel(/Change your reply/).fill('Sorry about the wait, Bilal. Your next visit is on us.');
    await card.getByRole('button', { name: 'Save the reply' }).click();
    await expect(card).toContainText('Your next visit is on us.');

    // The reply is on the business's public page.
    const pub = (await (await fetch(`${API}/v1/businesses/${place.slug}/reviews`)).json()) as {
      data: { comment: string; response: { text: string } | null }[];
    };
    expect(pub.data.find((r) => r.comment === comment)?.response?.text).toContain(
      'Your next visit is on us.',
    );

    await card.getByRole('button', { name: 'Report Bilal R.’s review' }).click();
    await card.getByLabel('Why report it?').selectOption('fake');
    await card.getByLabel(/Anything BUKU should know/).fill('No one waited that long that day');
    await card.getByRole('button', { name: 'Report it' }).click();
    await expect(card).toContainText('Reported');
    await expect(card.getByRole('button', { name: /^Report / })).toHaveCount(0);
    await page.getByRole('tab', { name: /Reported/ }).click();
    await expect(page.getByRole('listitem', { name: 'Review by Bilal R.' })).toBeVisible();
  });
});

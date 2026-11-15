import { randomUUID } from 'node:crypto';
import { goToPage, openBusiness, signIn } from './business-world';
import { closeBusiness } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * Verification (3.5m), for the owner: the checklist, the legal details (saved, then shown
 * masked) and a document sent straight to storage, checked by the API, then removed. Against
 * the development stack.
 */

const made: string[] = [];

/** The smallest file the API accepts as a PDF: it reads the signature, not the name. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

test.describe('Verification', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });
  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });
  // The document goes straight to storage, which allows only the headers it expects.
  test.use({ ownAddress: false });

  test('the checklist, the legal details shown masked, and a document sent and removed', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, `verify.owner.${randomUUID()}@example.com`, 'Hina Qureshi', true);
    const place = await openBusiness(page, made, 'Verification Test');

    await page.goto(`/business/${place.id}`);
    await goToPage(page, place.name, 'Verification');
    await expect(page).toHaveURL((url) => url.pathname === `/business/${place.id}/verification`);
    await expect(page.getByRole('heading', { name: 'Verification', level: 1 })).toBeVisible();
    const needs = page.getByRole('list', { name: 'What BUKU needs' });
    await expect(needs).toContainText('Legal and registration details submitted: still needed');
    await expectAccessible(page);

    // The legal details: a number the API wouldn't take is caught; then saved, and shown masked.
    const legal = page.getByRole('region', { name: 'Legal details' });
    await legal.getByLabel('Kind of registration').fill('SECP company');
    await legal.getByLabel('Registration number').fill('12');
    await legal.getByLabel('Name', { exact: true }).fill('Hina Qureshi');
    await legal.getByLabel('Role').fill('Owner');
    await legal.getByRole('button', { name: 'Save the legal details' }).click();
    await expect(legal.getByLabel('Registration number')).toHaveAttribute('aria-invalid', 'true');
    await legal.getByLabel('Registration number').fill('0123456-78');
    await legal.getByRole('button', { name: 'Save the legal details' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(legal).toContainText('SECP company, ••••');
    await expect(legal).not.toContainText('0123456-78');
    await expect(needs).toContainText('Legal and registration details submitted: done');

    // Changing them asks for the number again; it's never sent back masked.
    await legal.getByRole('button', { name: 'Change the details' }).click();
    await expect(legal.getByLabel('Registration number')).toHaveValue('');
    await expect(legal.getByText(/Saved as ••••/)).toBeVisible();
    await legal.getByRole('button', { name: 'Cancel' }).click();

    // A document: the wrong kind of file never leaves; a PDF goes to storage and waits for BUKU.
    const documents = page.getByRole('region', { name: 'Documents' });
    const file = documents.getByLabel('The file');
    await file.setInputFiles({
      name: 'licence.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a licence'),
    });
    await documents.getByRole('button', { name: 'Send the document' }).click();
    await expect(documents.getByText('Send a PDF, JPEG or PNG.')).toBeVisible();
    await file.setInputFiles({ name: 'licence.pdf', mimeType: 'application/pdf', buffer: PDF });
    await documents.getByRole('button', { name: 'Send the document' }).click();
    const sent = documents.getByRole('list', { name: 'Documents sent' });
    await expect(sent).toContainText('Business licence or registration');
    await expect(sent).toContainText('Waiting for BUKU');
    await expectAccessible(page);

    await sent.getByRole('button', { name: /Remove/ }).click();
    await expect(page.getByText('Document removed.')).toBeVisible();
    await expect(documents.getByRole('list', { name: 'Documents sent' })).toHaveCount(0);
  });
});

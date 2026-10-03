import { expect, test } from '@playwright/test';

/** The clean-text inputs (D-083) on the UI kit page, as a person would use them. */

const GRIN = String.fromCodePoint(0x1f600);
const STAR = String.fromCodePoint(0x2b50);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

test.describe('Clean text while typing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/kit');
  });

  test('an emoji typed into a name is removed, with a note saying why', async ({ page }) => {
    const name = page.getByLabel('Your name');
    await name.pressSequentially(`Ali ${GRIN}`);
    await expect(name).toHaveValue('Ali ');
    await expect(page.getByText('Emojis and picture symbols can’t be used here.')).toBeVisible();
    await name.pressSequentially('Khan');
    await expect(name).toHaveValue('Ali Khan');
  });

  test('a digit in a name is removed and the rule explained; the cursor stays put', async ({ page }) => {
    const name = page.getByLabel('Your name');
    await name.fill('Ali Khan');
    await name.press('Home');
    await name.press('ArrowRight');
    await name.press('ArrowRight');
    await name.press('ArrowRight');
    await name.pressSequentially('7');
    await expect(name).toHaveValue('Ali Khan');
    await expect(page.getByText("Letters, spaces, and . ' - only.")).toBeVisible();
    await name.pressSequentially('a');
    await expect(name).toHaveValue('Alia Khan');
  });

  test('pasted text is cleaned (invisible characters and emoji)', async ({ page }) => {
    const note = page.getByLabel('A note for the business');
    await note.focus();
    await page.evaluate(
      ([text]) => {
        const el = document.activeElement as HTMLTextAreaElement;
        const data = new DataTransfer();
        data.setData('text/plain', text!);
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
        if (!el.value) {
          // Browsers don't insert synthetic pastes; insert as the paste would.
          el.setRangeText(text!, 0, 0, 'end');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
      [`Great${ZERO_WIDTH_SPACE} cut ${STAR}`],
    );
    await expect(note).toHaveValue('Great cut ');
  });

  test('leaving a field tidies spaces and turns styled letters into ordinary ones', async ({ page }) => {
    const title = page.getByLabel('Business name');
    // Mathematical bold "BUKU" (styled letters some apps produce).
    const fancy = [0x1d401, 0x1d414, 0x1d40a, 0x1d414].map((c) => String.fromCodePoint(c)).join('');
    await title.fill(`  ${fancy}    Salon  `);
    await title.blur();
    await expect(title).toHaveValue('BUKU Salon');
  });

  test('typing in Urdu works (letters of any script)', async ({ page }) => {
    const name = page.getByLabel('Your name');
    const urdu = 'عائشہ خان';
    await name.pressSequentially(urdu);
    await expect(name).toHaveValue(urdu);
  });
});

import { PROFILES } from '../src/lib/brand';
import { expect, test } from './fixtures';
import { expectAccessible, useTheme } from './helpers';

/**
 * BUKU's profiles (lib/brand.ts): marks at the foot of every page, and "Follow BUKU" on the
 * contact page. Each opens the profile in a new tab and says so to a screen reader.
 */

const NAMES: Record<string, string> = {
  'www.instagram.com': 'Instagram',
  'www.facebook.com': 'Facebook',
  'x.com': 'X',
};

test.describe('BUKU on social media', () => {
  test('every page ends with BUKU’s profiles, each named and opening in a new tab', async ({ page }) => {
    for (const path of ['/', '/pricing']) {
      await page.goto(path);
      const row = page.getByRole('navigation', { name: 'BUKU on social media' });
      await expect(row.getByRole('link')).toHaveCount(PROFILES.length);
      for (const url of PROFILES) {
        const name = NAMES[new URL(url).hostname]!;
        const link = row.getByRole('link', { name: `BUKU on ${name} (opens in a new tab)` });
        await expect(link).toHaveAttribute('href', url);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /\bme\b/);
      }
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the contact page: Follow BUKU, each platform with its handle; WCAG in ${theme}`, async ({
      page,
      context,
      baseURL,
    }) => {
      await useTheme(context, theme, baseURL!);
      await page.goto('/contact');
      const band = page.getByRole('region', { name: 'Follow BUKU' });
      await expect(band.getByRole('link')).toHaveCount(PROFILES.length);
      await expect(band.getByRole('link', { name: /^Instagram @onbukuapp/ })).toHaveAttribute(
        'href',
        'https://www.instagram.com/onbukuapp',
      );
      await expect(band.getByRole('link', { name: /^Facebook onbukuapp/ })).toHaveAttribute(
        'href',
        'https://www.facebook.com/onbukuapp',
      );
      await expect(band.getByRole('link', { name: /^X @onbukuapp/ })).toHaveAttribute(
        'href',
        'https://x.com/onbukuapp',
      );
      await page.waitForLoadState('networkidle');
      await expectAccessible(page);
    });
  }
});

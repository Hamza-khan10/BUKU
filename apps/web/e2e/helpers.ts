import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Collect console errors, uncaught exceptions and Content-Security-Policy violations on a page. */
export async function watchForProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('console', (m) => {
    // A 404 page answers 404 on purpose; anything else logged as an error is a problem.
    if (m.type() === 'error' && !/status of 404/.test(m.text())) problems.push(m.text());
  });
  await page.addInitScript(() => {
    // Runs in the browser: the console is how the page reports back to the test.
    document.addEventListener('securitypolicyviolation', (e) =>
      // eslint-disable-next-line no-console
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return problems;
}

export async function useTheme(context: BrowserContext, theme: 'light' | 'dark', baseURL: string) {
  await context.addCookies([{ name: 'buku_theme', value: theme, url: baseURL }]);
}

/** WCAG 2.2 A/AA checks with axe; any violation fails, listed by rule and element. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

/** Is the API stack (gateway) up? Session tests need it; they skip when it isn't. */
export async function apiAvailable(): Promise<boolean> {
  const api = process.env.E2E_API_URL ?? 'http://localhost:8000';
  try {
    const res = await fetch(`${api}/v1/categories`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import { prelaunch } from '../src/lib/flags';
import { siteUrl } from '../src/lib/site-url';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Before launch (D-134)', () => {
  it('is pre-launch without the API (the site on Vercel today), or when PRELAUNCH says so', () => {
    vi.stubEnv('API_URL', '');
    vi.stubEnv('APP_URL', '');
    expect(prelaunch()).toBe(true);
    vi.stubEnv('API_URL', 'http://localhost:8000');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(prelaunch()).toBe(false);
    vi.stubEnv('PRELAUNCH', 'true');
    expect(prelaunch()).toBe(true);
  });

  it('knows its own address: APP_URL, else Vercel’s production address, else localhost', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    expect(siteUrl()).toBe('http://localhost:3000');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'buku-ruo5.vercel.app');
    expect(siteUrl()).toBe('https://buku-ruo5.vercel.app');
    vi.stubEnv('APP_URL', 'https://buku.pk/');
    expect(siteUrl()).toBe('https://buku.pk');
  });

  it('shows search engines nothing until indexing is allowed', () => {
    vi.stubEnv('ALLOW_INDEXING', 'false');
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  it('before launch, keeps out the pages that need the API, and the sitemap lists only what stands alone', async () => {
    vi.stubEnv('ALLOW_INDEXING', 'true');
    vi.stubEnv('API_URL', '');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'buku-ruo5.vercel.app');
    const rules = robots().rules as { disallow: string[] };
    expect(rules.disallow).toEqual(
      expect.arrayContaining(['/explore', '/c/', '/b/', '/business', '/account']),
    );
    expect(robots().sitemap).toBe('https://buku-ruo5.vercel.app/sitemap.xml');

    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const urls = (await sitemap()).map((e) => e.url);
    expect(fetch).not.toHaveBeenCalled(); // no API to ask
    expect(urls).toContain('https://buku-ruo5.vercel.app/early-access');
    expect(urls).toContain('https://buku-ruo5.vercel.app/for-business');
    expect(urls).not.toContain('https://buku-ruo5.vercel.app/explore');
    expect(urls.some((u) => u.includes('/legal/privacy'))).toBe(true);
  });

  it('after launch, lists the places too, and the API pages are open to search engines again', async () => {
    vi.stubEnv('ALLOW_INDEXING', 'true');
    vi.stubEnv('API_URL', 'http://api.test');
    vi.stubEnv('APP_URL', 'https://buku.pk');
    const rules = robots().rules as { disallow: string[] };
    expect(rules.disallow).not.toContain('/explore');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ data: url.includes('categories') ? [{ slug: 'barbers', children: [] }] : [] }),
        }),
      ),
    );
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://buku.pk/explore');
    expect(urls).toContain('https://buku.pk/c/barbers');
  });
});

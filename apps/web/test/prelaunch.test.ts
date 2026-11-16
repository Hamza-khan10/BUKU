import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import { prelaunch } from '../src/lib/flags';
import { siteUrl } from '../src/lib/site-url';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('takes a bare host as https, and sets aside an address that isn’t one instead of failing every page', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // How the Cloudflare dashboard's field was first filled in (2026-11-16): every page answered 500.
    vi.stubEnv('APP_URL', 'buku.example.workers.dev');
    expect(siteUrl()).toBe('https://buku.example.workers.dev');
    expect(() => new URL(siteUrl())).not.toThrow();
    vi.stubEnv('APP_URL', ' https://buku.pk/some/path ');
    expect(siteUrl()).toBe('https://buku.pk');
    for (const wrong of ['javascript:alert(1)', 'ftp://buku.pk', 'https://', 'not a web address']) {
      vi.stubEnv('APP_URL', wrong);
      expect(siteUrl(), wrong).toBe('http://localhost:3000');
    }
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
    // The categories and the prices stand without the API (D-137): open to search engines.
    expect(rules.disallow).not.toContain('/categories');
    expect(rules.disallow).not.toContain('/pricing');

    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const urls = (await sitemap()).map((e) => e.url);
    expect(fetch).not.toHaveBeenCalled(); // no API to ask
    expect(urls).toContain('https://buku-ruo5.vercel.app/early-access');
    expect(urls).toContain('https://buku-ruo5.vercel.app/for-business');
    expect(urls).not.toContain('https://buku-ruo5.vercel.app/explore');
    expect(urls).toContain('https://buku-ruo5.vercel.app/categories');
    expect(urls).toContain('https://buku-ruo5.vercel.app/pricing');
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

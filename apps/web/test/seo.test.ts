import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as llms } from '../src/app/llms.txt/route';
import { BUSINESS_QUESTIONS, faqStructuredData } from '../src/features/marketing/faq';
import { canonicalRedirect } from '../src/lib/http/canonical-host';
import { jsonLd, pageMetadata } from '../src/lib/seo';
import { beaconSettings, webAnalyticsToken } from '../src/lib/web-analytics';

afterEach(() => {
  vi.unstubAllEnvs();
});

const at = (href: string) => new URL(href);

describe('One address (D-136)', () => {
  const site = 'https://onbuku.com';

  it('sends www. and workers.dev to the one address, same path and query, on the live site', () => {
    const page = at('https://www.onbuku.com/pricing?source=ig');
    expect(canonicalRedirect(page, 'www.onbuku.com', site, true)?.href).toBe(
      'https://onbuku.com/pricing?source=ig',
    );
    expect(
      canonicalRedirect(
        at('https://buku.example.workers.dev/early-access'),
        'buku.example.workers.dev',
        site,
        true,
      )?.href,
    ).toBe('https://onbuku.com/early-access');
    expect(canonicalRedirect(page, 'WWW.ONBUKU.COM:443', site, true)?.href).toBe(
      'https://onbuku.com/pricing?source=ig',
    );
  });

  it('leaves alone the address itself, other hosts, previews, development and a non-https address', () => {
    const page = at('https://onbuku.com/');
    expect(canonicalRedirect(page, 'onbuku.com', site, true)).toBeNull();
    expect(canonicalRedirect(page, 'evil.example', site, true)).toBeNull(); // never an open redirect
    expect(canonicalRedirect(page, 'www.onbuku.com', site, false)).toBeNull(); // not the live site
    expect(canonicalRedirect(page, null, site, true)).toBeNull();
    expect(canonicalRedirect(page, 'localhost:3000', 'http://localhost:3000', true)).toBeNull();
    expect(canonicalRedirect(page, 'buku.example.workers.dev', 'http://onbuku.com', true)).toBeNull();
    expect(canonicalRedirect(page, 'buku.example.workers.dev', 'not an address', true)).toBeNull();
  });
});

describe('Page metadata (D-136)', () => {
  it('gives a page its own title, one canonical address and its own share card', () => {
    const m = pageMetadata({ title: 'Pricing', description: 'Plans.', path: '/pricing' });
    expect(m.title).toBe('Pricing');
    expect(m.alternates?.canonical).toBe('/pricing');
    expect(m.openGraph).toMatchObject({ title: 'Pricing · BUKU', description: 'Plans.', url: '/pricing' });
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', title: 'Pricing · BUKU' });
    // Its own card still carries the picture (Next drops the inherited one when a page sets its own).
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ url: '/og/buku.png', width: 1200 })]);
    const home = pageMetadata({ title: 'BUKU: book', description: 'd', path: '/', absoluteTitle: true });
    expect(home.title).toEqual({ absolute: 'BUKU: book' });
    expect(home.openGraph).toMatchObject({ title: 'BUKU: book' });
  });

  it('structured data can never end its script block early', () => {
    const out = jsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>' });
  });

  it('the questions businesses ask become FAQPage data, word for word', () => {
    const data = faqStructuredData(BUSINESS_QUESTIONS);
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(BUSINESS_QUESTIONS.length);
    expect(data.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: BUSINESS_QUESTIONS[0]!.q,
      acceptedAnswer: { '@type': 'Answer', text: BUSINESS_QUESTIONS[0]!.a },
    });
    expect(new Set(BUSINESS_QUESTIONS.map((q) => q.id)).size).toBe(BUSINESS_QUESTIONS.length);
    // Plain text only: answers are read as they are by engines (no markup, no em dashes).
    for (const { q, a } of BUSINESS_QUESTIONS) expect(`${q} ${a}`).not.toMatch(/[<>—]/);
  });
});

describe('llms.txt (D-136)', () => {
  it('describes BUKU at its one address, with the same questions /for-business shows', async () => {
    vi.stubEnv('APP_URL', 'https://onbuku.com');
    vi.stubEnv('API_URL', '');
    const res = llms();
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const text = await res.text();
    expect(text.startsWith('# BUKU\n\n> ')).toBe(true);
    expect(text).toContain('[For businesses](https://onbuku.com/for-business)');
    expect(text).toContain('[Early access](https://onbuku.com/early-access)'); // before launch
    for (const { q } of BUSINESS_QUESTIONS) expect(text).toContain(`### ${q}`);
    expect(text).not.toContain('localhost');
    // The prices, both currencies, as the pricing page shows them (D-137).
    expect(text).toContain('- Essential (for barbers, clinics and local shops): Rs 2,499 or $15');
    expect(text).toContain('[Categories](https://onbuku.com/categories)');
    expect(text).toContain('- [Health & Medical](https://onbuku.com/c/health-medical): Dental Clinic, ');
  });
});

describe('Counting visits (D-136)', () => {
  it('is on only with a token that looks like one', () => {
    expect(webAnalyticsToken()).toBeNull();
    const token = randomBytes(16).toString('hex'); // made here: a literal would look like a leaked key
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', ` ${token} `);
    expect(webAnalyticsToken()).toBe(token);
    vi.stubEnv('CF_WEB_ANALYTICS_TOKEN', '"><script>alert(1)</script>');
    expect(webAnalyticsToken()).toBeNull();
    expect(JSON.parse(beaconSettings('abc123abc123abc123'))).toEqual({
      token: 'abc123abc123abc123',
      spa: true,
    });
  });
});

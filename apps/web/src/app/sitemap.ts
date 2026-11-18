import type { MetadataRoute } from 'next';
import { LEGAL_SLUGS } from '@/content/legal';
import { prelaunch } from '@/lib/flags';
import { CATEGORY_SNAPSHOT } from '@/features/categories/snapshot';
import { siteUrl } from '@/lib/site-url';

/**
 * Every public page for search engines: the site's own pages, every category
 * and every listed business (from the API, so suspended or deleted ones drop
 * out by themselves). Regenerated hourly. Search engines only read it once the
 * site may be indexed (robots.ts).
 */
export const revalidate = 3600;

/** Before launch (D-134), the pages that need the API wait; the early-access list is the door. */
// /categories stands without the API (its kinds are kept in the site, D-137); /explore doesn't.
const NEED_THE_API = new Set(['/explore']);

const STATIC = [
  '/',
  '/early-access',
  '/explore',
  '/categories',
  '/how-it-works',
  '/pricing',
  '/for-business',
  '/about',
  '/contact',
  '/help',
  '/security',
  '/legal',
];

interface Node {
  slug: string;
  children: Node[];
}

async function get<T>(api: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${api}${path}`, { next: { revalidate }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as { data: T }).data : null;
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  const api = process.env.API_URL || 'http://localhost:8000';
  const early = prelaunch();
  const entries: MetadataRoute.Sitemap = [
    ...STATIC.filter((path) => !(early && NEED_THE_API.has(path))).map((path) => ({
      url: `${site}${path}`,
      changeFrequency: 'weekly' as const,
    })),
    ...LEGAL_SLUGS.map((slug) => ({ url: `${site}/legal/${slug}`, changeFrequency: 'monthly' as const })),
  ];
  // Before launch every category's guide stands without the API (D-139): all 127 pages.
  if (early)
    return [
      ...entries,
      ...CATEGORY_SNAPSHOT.flatMap((g) => [g, ...g.children]).map((c) => ({
        url: `${site}/c/${c.slug}`,
        changeFrequency: 'weekly' as const,
      })),
    ];

  const tree = (await get<Node[]>(api, '/v1/categories')) ?? [];
  for (const c of tree.flatMap((n) => [n, ...n.children])) {
    entries.push({ url: `${site}/c/${c.slug}`, changeFrequency: 'daily' });
  }

  // Every listed business, 50 at a time (the search API's largest page).
  for (let page = 1; page <= 50; page++) {
    const items = await get<{ slug: string }[]>(
      api,
      `/v1/businesses/search?sort=newest&limit=50&page=${page}`,
    );
    if (!items || items.length === 0) break;
    for (const b of items) entries.push({ url: `${site}/b/${b.slug}`, changeFrequency: 'daily' });
    if (items.length < 50) break;
  }
  return entries;
}

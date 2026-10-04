import type { MetadataRoute } from 'next';
import { LEGAL_SLUGS } from '@/content/legal';

/**
 * Every public page for search engines: the site's own pages, every category
 * and every listed business (from the API, so suspended or deleted ones drop
 * out by themselves). Regenerated hourly. Search engines only read it once the
 * site may be indexed (robots.ts).
 */
export const revalidate = 3600;

const STATIC = [
  '/',
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
  const site = process.env.APP_URL || 'http://localhost:3000';
  const api = process.env.API_URL || 'http://localhost:8000';
  const entries: MetadataRoute.Sitemap = [
    ...STATIC.map((path) => ({ url: `${site}${path}`, changeFrequency: 'weekly' as const })),
    ...LEGAL_SLUGS.map((slug) => ({ url: `${site}/legal/${slug}`, changeFrequency: 'monthly' as const })),
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

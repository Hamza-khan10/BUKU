import { z } from 'zod';

/**
 * Search filters as they live in the address bar (/explore?q=…&openNow=1),
 * so every search can be shared, bookmarked and reached with Back. Anything
 * odd in the address is dropped — never passed to the API as is.
 */

export const SORTS = ['relevance', 'rating', 'newest'] as const;
export type Sort = (typeof SORTS)[number];

export interface Filters {
  q: string;
  city: string;
  category: string;
  openNow: boolean;
  hasQueue: boolean;
  verifiedOnly: boolean;
  topRated: boolean;
  sort: Sort;
  page: number;
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  city: '',
  category: '',
  openNow: false,
  hasQueue: false,
  verifiedOnly: false,
  topRated: false,
  sort: 'relevance',
  page: 1,
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const flag = (v: string | string[] | undefined) => one(v) === '1';

/** Read filters from a page's search params (Next's `searchParams`). */
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const q = one(params.q).trim().slice(0, 100);
  const city = one(params.city).trim().slice(0, 100);
  const category = /^[a-z0-9-]{1,100}$/.test(one(params.category)) ? one(params.category) : '';
  const sort = (SORTS as readonly string[]).includes(one(params.sort))
    ? (one(params.sort) as Sort)
    : 'relevance';
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .catch(1)
    .parse(one(params.page) || 1);
  return {
    q,
    city,
    category,
    openNow: flag(params.openNow),
    hasQueue: flag(params.hasQueue),
    verifiedOnly: flag(params.verifiedOnly),
    topRated: flag(params.topRated),
    sort,
    page,
  };
}

/** The address for these filters ("/explore?q=haircut&openNow=1"), without defaults. */
export function filtersQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.city) p.set('city', f.city);
  if (f.category) p.set('category', f.category);
  if (f.openNow) p.set('openNow', '1');
  if (f.hasQueue) p.set('hasQueue', '1');
  if (f.verifiedOnly) p.set('verifiedOnly', '1');
  if (f.topRated) p.set('topRated', '1');
  if (f.sort !== 'relevance') p.set('sort', f.sort);
  if (f.page > 1) p.set('page', String(f.page));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/** Change some filters; any change other than the page starts again from page 1. */
export function withFilters(f: Filters, change: Partial<Filters>): Filters {
  return { ...f, ...change, page: change.page ?? 1 };
}

/** What the search API is asked for these filters. */
export function apiQuery(f: Filters, limit = 12): Record<string, string | number | boolean | undefined> {
  return {
    q: f.q || undefined,
    city: f.city || undefined,
    category: f.category || undefined,
    openNow: f.openNow || undefined,
    hasQueue: f.hasQueue || undefined,
    verifiedOnly: f.verifiedOnly || undefined,
    minRating: f.topRated ? 4 : undefined,
    sort: f.sort,
    page: f.page,
    limit,
  };
}

/** How many filters (beyond the words and the city) are on — for the "Filters (2)" button. */
export const activeFilterCount = (f: Filters) =>
  [f.openNow, f.hasQueue, f.verifiedOnly, f.topRated, Boolean(f.category)].filter(Boolean).length;

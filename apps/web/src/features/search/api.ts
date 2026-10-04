import 'server-only';
import { findPublic, getPublic } from '@/lib/api/public';
import { apiQuery, type Filters } from './params';
import type { CategoryDetail, CategoryNode, City, SearchItem, SearchMeta } from './types';

/** Discovery data for server-rendered pages: public, briefly cached, the same for everyone. */

export const PAGE_SIZE = 12;

export async function searchBusinesses(f: Filters) {
  const path = f.category ? `/v1/categories/${f.category}/businesses` : '/v1/businesses/search';
  const query = apiQuery(f, PAGE_SIZE);
  if (f.category) delete query.category;
  return getPublic<SearchItem[], SearchMeta>(path, { revalidate: 30, query });
}

export async function categoryTree() {
  return (await getPublic<CategoryNode[]>('/v1/categories', { revalidate: 300 })).data;
}

export async function category(slug: string) {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null;
  return (await findPublic<CategoryDetail>(`/v1/categories/${slug}`, { revalidate: 300 }))?.data ?? null;
}

export async function cities() {
  return (await getPublic<City[]>('/v1/cities', { revalidate: 300 })).data;
}

/** A small shelf of places for the home page (empty when there's nothing true to show). */
export async function shelf(
  query: Record<string, string | number | boolean | undefined>,
  path = '/v1/businesses/search',
) {
  try {
    return (await getPublic<SearchItem[]>(path, { revalidate: 60, query })).data;
  } catch {
    return [];
  }
}

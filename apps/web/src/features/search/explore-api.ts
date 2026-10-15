import { apiCall } from '@/lib/api/client';
import { EXPLORE_PAGE_SIZE, type ExplorePage } from './explore';
import { apiQuery, type Filters } from './params';
import type { SearchItem, SearchMeta } from './types';

/** One page of an explore search, through our own server (the browser never calls the API directly). */
export async function fetchExplorePage(f: Filters, page: number, signal?: AbortSignal): Promise<ExplorePage> {
  const path = f.category ? `categories/${f.category}/businesses` : 'businesses/search';
  const query = apiQuery({ ...f, page }, EXPLORE_PAGE_SIZE);
  if (f.category) delete query.category;
  const res = await apiCall<SearchItem[], SearchMeta>(path, { query, signal });
  return {
    items: res.data,
    meta: res.meta ?? {
      page,
      limit: EXPLORE_PAGE_SIZE,
      total: res.data.length,
      totalPages: page,
      sort: f.sort,
    },
  };
}

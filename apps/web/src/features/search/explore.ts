import { filtersQuery, parseFilters, type Filters } from './params';
import type { SearchItem, SearchMeta } from './types';

/**
 * The explore page in the browser (D-104): the address still holds the search, but after the
 * first page (rendered on the server) every change and every "more" is fetched right here, so
 * the page never reloads. Pages come 12 at a time; the API stops at page 50. (The call itself is
 * in explore-api.ts.)
 */

export const EXPLORE_PAGE_SIZE = 12;
export const LAST_PAGE = 50;
/** Pages fetched by themselves as you scroll; after these, "Show more" (so the footer stays reachable). */
export const AUTO_PAGES = 5;

export interface ExplorePage {
  items: SearchItem[];
  meta: SearchMeta;
}

/** The filters in an address's query string (anything odd dropped, as on the server). */
export function filtersFrom(params: URLSearchParams): Filters {
  const record: Record<string, string> = {};
  params.forEach((value, key) => {
    record[key] ??= value;
  });
  return { ...parseFilters(record), page: 1 };
}

/** The address for a search, without a page: results continue on the page itself. */
export const exploreHref = (f: Filters) => `/explore${filtersQuery({ ...f, page: 1 })}`;

/** One key per search (the page isn't part of it: pages are the pieces of one list). */
export const exploreKey = (f: Filters) => ['explore', filtersQuery({ ...f, page: 1 })] as const;

/** The next page to fetch after this one, or undefined at the end. */
export function nextPage(last: ExplorePage): number | undefined {
  const { page, totalPages } = last.meta;
  return page < totalPages && page < LAST_PAGE ? page + 1 : undefined;
}

/** Every page's places in order, each place once (a page fetched later may repeat one that moved). */
export function placesOf(pages: ExplorePage[]): SearchItem[] {
  const seen = new Set<string>();
  const out: SearchItem[] = [];
  for (const p of pages) {
    for (const item of p.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

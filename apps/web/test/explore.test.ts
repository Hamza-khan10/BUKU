import { describe, expect, it } from 'vitest';
import {
  exploreHref,
  exploreKey,
  filtersFrom,
  nextPage,
  placesOf,
  type ExplorePage,
} from '../src/features/search/explore';
import type { SearchItem } from '../src/features/search/types';

const place = (id: string) => ({ id, name: `Place ${id}` }) as SearchItem;
const page = (n: number, totalPages: number, ids: string[]): ExplorePage => ({
  items: ids.map(place),
  meta: { page: n, limit: 12, total: totalPages * 12, totalPages, sort: 'relevance' },
});

describe('explore: the search in the address', () => {
  it('reads it safely and never starts past the first page', () => {
    const f = filtersFrom(
      new URLSearchParams('q=haircut&city=Lahore&openNow=1&page=7&category=<b>&sort=evil'),
    );
    expect(f).toMatchObject({
      q: 'haircut',
      city: 'Lahore',
      openNow: true,
      page: 1,
      category: '',
      sort: 'relevance',
    });
  });
  it('writes it without a page, so a shared link opens the same search from the top', () => {
    const f = filtersFrom(new URLSearchParams('q=haircut&openNow=1'));
    expect(exploreHref({ ...f, page: 4 })).toBe('/explore?q=haircut&openNow=1');
    expect(exploreKey({ ...f, page: 4 })).toEqual(exploreKey(f));
  });
});

describe('explore: pages of places', () => {
  it('asks for the next page until the last one (and never past page 50)', () => {
    expect(nextPage(page(1, 3, []))).toBe(2);
    expect(nextPage(page(3, 3, []))).toBeUndefined();
    expect(nextPage(page(50, 80, []))).toBeUndefined();
  });
  it('shows each place once, in order, even when a later page repeats one that moved', () => {
    const list = placesOf([page(1, 2, ['a', 'b', 'c']), page(2, 2, ['c', 'd'])]);
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

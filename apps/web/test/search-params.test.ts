import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  apiQuery,
  EMPTY_FILTERS,
  filtersQuery,
  parseFilters,
  withFilters,
} from '../src/features/search/params';

describe('search filters in the address bar', () => {
  it('read what is there, and only what makes sense', () => {
    const f = parseFilters({
      q: '  haircut ',
      city: 'Lahore',
      category: 'barbershop',
      openNow: '1',
      hasQueue: 'yes', // not "1": off
      sort: 'rating',
      page: '3',
    });
    expect(f).toMatchObject({
      q: 'haircut',
      city: 'Lahore',
      category: 'barbershop',
      openNow: true,
      hasQueue: false,
    });
    expect(f.sort).toBe('rating');
    expect(f.page).toBe(3);
  });

  it('drop anything odd instead of passing it on', () => {
    const f = parseFilters({ category: '../admin', sort: 'drop table', page: '9999', q: 'x'.repeat(500) });
    expect(f.category).toBe('');
    expect(f.sort).toBe('relevance');
    expect(f.page).toBe(1);
    expect(f.q).toHaveLength(100);
    expect(parseFilters({ page: ['2', '5'] }).page).toBe(2);
  });

  it('write short addresses, and start from page 1 when filters change', () => {
    expect(filtersQuery(EMPTY_FILTERS)).toBe('');
    const f = { ...EMPTY_FILTERS, q: 'beard trim', openNow: true, page: 4 };
    expect(filtersQuery(f)).toBe('?q=beard+trim&openNow=1&page=4');
    expect(withFilters(f, { hasQueue: true }).page).toBe(1);
    expect(withFilters(f, { page: 5 }).page).toBe(5);
  });

  it('ask the API for exactly these filters', () => {
    const f = { ...EMPTY_FILTERS, topRated: true, openNow: true };
    expect(apiQuery(f)).toMatchObject({
      minRating: 4,
      openNow: true,
      hasQueue: undefined,
      sort: 'relevance',
      limit: 12,
    });
    expect(activeFilterCount(f)).toBe(2);
  });
});

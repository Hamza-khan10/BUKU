import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { categoriesFrom, MIGRATION } from '../scripts/category-snapshot';
import { CATEGORY_SNAPSHOT } from '../src/features/categories/snapshot';
import {
  COMPARISON,
  currencyFor,
  CURRENCIES,
  LAUNCH_PLANS,
  money,
  priceFor,
} from '../src/features/pricing/launch-plans';

describe('Prices at launch (D-137)', () => {
  it('rupees for Pakistan, dollars for everyone else', () => {
    expect(currencyFor('PK')).toBe('PKR');
    expect(currencyFor(' pk ')).toBe('PKR');
    for (const elsewhere of ['GB', 'US', 'AE', 'IN', 'XX', 'T1', '', null, undefined])
      expect(currencyFor(elsewhere)).toBe('USD');
  });

  it('every plan has a price in both currencies; they rise from Starter (free) to Professional', () => {
    for (const currency of CURRENCIES) {
      const price = (id: string) => LAUNCH_PLANS.find((p) => p.id === id)!.monthly[currency];
      expect(price('starter')).toBe(0);
      expect(price('essential')).toBeGreaterThan(0);
      expect(price('professional')).toBeGreaterThan(price('essential'));
      // Network is Professional for each branch, for less.
      expect(price('network')).toBeLessThan(price('professional'));
      expect(price('network')).toBeGreaterThan(price('essential'));
    }
    expect(LAUNCH_PLANS.filter((p) => p.suggested).map((p) => p.id)).toEqual(['professional']);
  });

  it('a year costs ten months; the monthly figure shown for a year is rounded to whole units', () => {
    const essential = LAUNCH_PLANS.find((p) => p.id === 'essential')!;
    expect(priceFor(essential, 'PKR', 'month')).toEqual({ perMonth: 2499, billed: 2499 });
    expect(priceFor(essential, 'PKR', 'year')).toEqual({ perMonth: 2083, billed: 24990 });
    expect(priceFor(essential, 'USD', 'year')).toEqual({ perMonth: 13, billed: 150 });
  });

  it('prices read the same on the server and in every browser', () => {
    expect(money(2499, 'PKR')).toBe('Rs 2,499');
    expect(money(24990, 'PKR')).toBe('Rs 24,990');
    expect(money(1234567, 'PKR')).toBe('Rs 1,234,567');
    expect(money(15, 'USD')).toBe('$15');
    expect(money(0, 'USD')).toBe('$0');
  });

  it('the comparison says something for every plan in every row', () => {
    const columns = [...LAUNCH_PLANS.map((p) => p.id), 'enterprise'].sort();
    for (const { rows } of COMPARISON)
      for (const row of rows) expect(Object.keys(row.values).sort(), row.label).toEqual(columns);
  });
});

describe('Categories without the API (D-137)', () => {
  it('the site’s snapshot is exactly the migration’s categories (run the script if this fails)', () => {
    const fromMigration = categoriesFrom(readFileSync(MIGRATION, 'utf8'));
    expect(CATEGORY_SNAPSHOT).toEqual(fromMigration);
    expect(fromMigration).toHaveLength(11);
    expect(fromMigration.reduce((n, g) => n + g.children.length, 0)).toBe(116);
    expect(fromMigration[0]).toMatchObject({ slug: 'beauty-hair', name: 'Beauty & Hair' });
  });
});

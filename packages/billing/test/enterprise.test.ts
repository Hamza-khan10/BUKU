import { describe, expect, it } from 'vitest';
import { dealMonthlyMinor, quoteEnterprise, type QuoteTerms, type RateTier } from '../src/enterprise.js';

/**
 * Made-up figures: the owner's real rate card is private and lives only in the database (D-151).
 * Three tiers, in cents: from 6 branches 100.00 a branch (floor 60.00), from 25 90.00 (55.00),
 * from 50 80.00 (50.00).
 */
const card: RateTier[] = [
  { fromBranches: 50, priceMinor: 8000, floorMinor: 5000 },
  { fromBranches: 6, priceMinor: 10000, floorMinor: 6000 },
  { fromBranches: 25, priceMinor: 9000, floorMinor: 5500 },
];
const terms: QuoteTerms = {
  costPerBranchMinor: 1000,
  yearlyDiscountPercent: 10,
  twoYearDiscountPercent: 15,
  askedDiscountPercent: 10,
  askedDiscountFromBranches: 50,
  withholdingPercent: 4,
};

describe('Enterprise quotes (D-151)', () => {
  it('prices a chain by its tier, a month at a time, with what it costs and keeps', () => {
    const q = quoteEnterprise(card, terms, { branches: 10, term: 'month' });
    expect(q).toMatchObject({
      ok: true,
      tier: { fromBranches: 6, toBranches: 24, listMinor: 10000, floorMinor: 6000 },
      discounts: { termPercent: 0, asked: 0, given: 0, limitedBy: null },
      perBranchMinor: 10000,
      monthlyMinor: 100000,
      listMonthlyMinor: 100000,
      invoiceMinor: 100000,
      withheldMinor: 4000,
      costMonthlyMinor: 10000,
      marginMonthlyMinor: 90000,
      marginPercent: 90,
      floorMonthlyMinor: 60000,
      heldAtTier: null,
      heldAtFloor: false,
    });
  });

  it('never charges a chain more for fewer branches: 24 pays what 25 would', () => {
    const at24 = quoteEnterprise(card, terms, { branches: 24, term: 'month' });
    const at25 = quoteEnterprise(card, terms, { branches: 25, term: 'month' });
    const at23 = quoteEnterprise(card, terms, { branches: 23, term: 'month' });
    // 24 × 100.00 = 2,400 is more than 25 × 90.00 = 2,250: held there. 23 × 100 = 2,300 is too.
    expect(at25).toMatchObject({ monthlyMinor: 225000, heldAtTier: null });
    expect(at24).toMatchObject({
      monthlyMinor: 225000,
      heldAtTier: { fromBranches: 25, monthlyMinor: 225000 },
    });
    expect(at23).toMatchObject({ monthlyMinor: 225000, perBranchMinor: 9783 });
    // Every size, one branch more never costs less.
    let before = 0;
    for (let n = 6; n <= 120; n++) {
      const q = quoteEnterprise(card, terms, { branches: n, term: 'month' });
      if (!q.ok) throw new Error('no quote');
      expect(q.monthlyMinor, `${n} branches`).toBeGreaterThanOrEqual(before);
      before = q.monthlyMinor;
    }
  });

  it('takes off for paying ahead, and what a big enough chain asks, up to the most', () => {
    const yearly = quoteEnterprise(card, terms, { branches: 60, term: 'year', askedDiscountPercent: 15 });
    // 80.00, 10% off for a year, then 10% of the 15% asked (the most): 64.80 a branch.
    expect(yearly).toMatchObject({
      discounts: { termPercent: 10, asked: 15, given: 10, limitedBy: 'most' },
      perBranchMinor: 6480,
      monthlyMinor: 388800,
      invoiceMinor: 388800 * 12,
    });
    // Too small to ask: nothing taken off for asking.
    const small = quoteEnterprise(card, terms, { branches: 30, term: 'two_years', askedDiscountPercent: 5 });
    expect(small).toMatchObject({
      discounts: { termPercent: 15, asked: 5, given: 0, limitedBy: 'chain_size' },
      perBranchMinor: 7650,
      invoiceMinor: 7650 * 30 * 24,
    });
  });

  it('holds a branch at its tier’s floor, whatever is taken off', () => {
    const steep = { ...terms, twoYearDiscountPercent: 40 };
    // 90.00 less 40% is 54.00, under the 55.00 floor.
    expect(quoteEnterprise(card, steep, { branches: 30, term: 'two_years' })).toMatchObject({
      perBranchMinor: 5500,
      heldAtFloor: true,
      monthlyMinor: 5500 * 30,
    });
  });

  it('starts where the rate card does, and needs one', () => {
    expect(quoteEnterprise(card, terms, { branches: 5, term: 'month' })).toEqual({
      ok: false,
      reason: 'below_enterprise',
      fromBranches: 6,
    });
    expect(quoteEnterprise([], terms, { branches: 40, term: 'month' })).toEqual({
      ok: false,
      reason: 'no_rate_card',
    });
  });

  it('a deal brings its price a branch for every branch the chain has now', () => {
    expect(dealMonthlyMinor(9000, 26)).toBe(234000);
    expect(dealMonthlyMinor(9000, 0)).toBe(0);
  });
});

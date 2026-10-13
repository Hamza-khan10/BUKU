import { describe, expect, it } from 'vitest';
import { categoryKey, categoryNameProblem, zCategoryName } from '../src/categories';

describe('A kind of business an owner adds (D-098)', () => {
  it('names that mean the same share one key', () => {
    const same = [
      'Barbershop',
      'Barber Shop',
      'barbershops',
      'BARBER-SHOP',
      ' Barber  shop ',
      'Ｂａｒｂｅｒｓｈｏｐ',
    ];
    expect(new Set(same.map(categoryKey))).toEqual(new Set(['barbershop']));
    expect(categoryKey('Health & Medical')).toBe(categoryKey('Health and medical'));
    expect(categoryKey('Spa')).toBe('spa'); // short words keep their last letter
    expect(categoryKey('Gas')).not.toBe(categoryKey('Ga'));
    expect(categoryKey('ٹیلر')).toBe('ٹیلر'); // Urdu letters count as letters
  });

  it('cleans what can be cleaned, and refuses what would corrupt or deface the list', () => {
    const ok = zCategoryName.safeParse('  Tattoo   studio ');
    expect(ok.success && ok.data).toBe('Tattoo studio');
    for (const bad of [
      '<script>alert(1)</script>',
      'Spa 💆',
      'Hair\u200Bcut', // an invisible character inside
      'Kebab / Grill',
      'a',
      '123',
      '--',
      'x'.repeat(41),
      "Robert'); DROP TABLE categories;--",
    ]) {
      expect(zCategoryName.safeParse(bad).success, bad).toBe(false);
    }
    expect(categoryNameProblem("Women's & Kids' Tailor")).toBeNull();
    expect(categoryNameProblem('24-hour Pharmacy')).toBeNull();
  });
});

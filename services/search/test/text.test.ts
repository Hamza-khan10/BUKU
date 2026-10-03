import { describe, expect, it } from 'vitest';
import { escapeLike, normalizeQuery, prefixTsQuery, queryForAnalytics, words } from '../src/text.js';

describe('Search input', () => {
  it('is normalised: Unicode forms, spaces, length', () => {
    expect(normalizeQuery('  Ｈａｉｒ   salon \n')).toBe('Hair salon');
    expect(normalizeQuery('x'.repeat(300))).toHaveLength(100);
  });

  it('full-text queries are rebuilt from words only (no syntax gets through)', () => {
    expect(prefixTsQuery('hair sal')).toBe('hair:* & sal:*');
    expect(prefixTsQuery("barber' | !x & (y:*)")).toBe('barber:* & x:* & y:*');
    expect(prefixTsQuery('  !!! ')).toBeNull();
    expect(prefixTsQuery('حجام نائی')).toBe('حجام:* & نائی:*');
    expect(words('a b c d e f g h i j')).toHaveLength(8);
  });

  it('LIKE wildcards match themselves', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('analytics never keeps contact details people type into the box', () => {
    expect(queryForAnalytics('  Haircut ')).toBe('haircut');
    expect(queryForAnalytics('0300 1234567')).toBe('[redacted]');
    expect(queryForAnalytics('+92 (300) 123-4567')).toBe('[redacted]');
    expect(queryForAnalytics('ali@example.com')).toBe('[redacted]');
    expect(queryForAnalytics('clinic 24/7')).toBe('clinic 24/7');
  });
});

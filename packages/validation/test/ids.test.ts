import { describe, expect, it } from 'vitest';
import { isDecimalId, isIdOrSlug, isPublicId } from '../src/ids';

describe('the API’s identifiers (DB-042)', () => {
  it('a public ID is 12 Base62 characters, nothing else', () => {
    expect(isPublicId('z6rR1qZjf3Pj')).toBe(true);
    for (const bad of [
      'z6rR1qZjf3P',
      'z6rR1qZjf3Pjx',
      'z6rR1qZjf3P-',
      '6f1c0d1e-0d1e-4c1e-8d1e-0d1e6f1c0d1e',
      42,
      null,
    ])
      expect(isPublicId(bad)).toBe(false);
  });

  it('a decimal ID is a positive 64-bit number, written without leading zeros', () => {
    expect(isDecimalId('106122918240821248')).toBe(true);
    expect(isDecimalId('9223372036854775807')).toBe(true); // the largest
    for (const bad of ['0', '012', '-5', '9223372036854775808', '99999999999999999999', '1e5', ' 12', 12])
      expect(isDecimalId(bad)).toBe(false);
  });

  it('a business’s address is its public ID or its slug', () => {
    for (const ok of ['z6rR1qZjf3Pj', 'fade-masters-lahore', 'salon7']) expect(isIdOrSlug(ok)).toBe(true);
    for (const bad of ['Fade-Masters', '-fade', 'fade--masters', 'fade_masters', '../admin', 'a'.repeat(201)])
      expect(isIdOrSlug(bad)).toBe(false);
  });
});

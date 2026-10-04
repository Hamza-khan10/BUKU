import { Store } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { categoryIcon } from '../src/features/categories/icons';

describe('category icons', () => {
  it('draw each known category, and a plain shop for any other', () => {
    expect(categoryIcon('barbershop')).not.toBe(Store);
    expect(categoryIcon('a-category-added-later')).toBe(Store);
  });

  it('never pick up names every object has', () => {
    for (const slug of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(categoryIcon(slug)).toBe(Store);
    }
  });
});

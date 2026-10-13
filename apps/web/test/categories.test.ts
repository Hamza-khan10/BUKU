import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { categoryIcon } from '../src/features/categories/icons';

/** Every category slug the migrations ship (the groups and kinds inserted with INSERT … VALUES). */
function shippedSlugs(): string[] {
  const dir = join(import.meta.dirname, '../../../packages/database/prisma/migrations');
  const sql = readdirSync(dir)
    .filter((m) => m.endsWith('_categories'))
    .map((m) => readFileSync(join(dir, m, 'migration.sql'), 'utf8'))
    .join('\n');
  const groups = [...sql.matchAll(/^\s*\(gen_random_uuid\(\), '[^']+', '([a-z0-9-]+)'/gm)].map((m) => m[1]!);
  const kinds = [...sql.matchAll(/^\s*\('[a-z0-9-]+', '[^']+', '([a-z0-9-]+)'/gm)].map((m) => m[1]!);
  return [...groups, ...kinds];
}

describe('category icons', () => {
  it('draw each known category, and a plain shop for any other', () => {
    expect(categoryIcon('barbershop')).not.toBe(Store);
    expect(categoryIcon('a-category-added-later')).toBe(Store);
  });

  it('have one for every category BUKU ships', () => {
    const slugs = shippedSlugs();
    expect(slugs.length).toBeGreaterThan(100);
    expect(slugs.filter((slug) => categoryIcon(slug) === Store)).toEqual([]);
  });

  it('never pick up names every object has', () => {
    for (const slug of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(categoryIcon(slug)).toBe(Store);
    }
  });
});

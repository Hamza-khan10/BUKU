import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { categoryIcon } from '../src/features/categories/icons';

/** Every category slug the migrations ship (the groups and kinds inserted with INSERT … VALUES). */
function shippedSlugs(): string[] {
  // The kinds of business BUKU ships: reference data on the directory (DB-015), in its migration.
  const sql = readFileSync(
    join(
      import.meta.dirname,
      '../../../packages/database/prisma/directory/migrations/20261017130000_reference/migration.sql',
    ),
    'utf8',
  );
  const block = sql.slice(sql.indexOf('INSERT INTO "reference"."categories"'));
  const rows = block.slice(0, block.indexOf(';'));
  return [
    ...rows.matchAll(/^\s*\(\d+, (?:NULL|\d+), \d, \d+, (?:true|false), (?:true|false), '([a-z0-9-]+)'/gm),
  ].map((m) => m[1]!);
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

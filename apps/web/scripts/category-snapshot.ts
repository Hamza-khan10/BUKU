/**
 * Writes src/features/categories/snapshot.ts: every kind of place BUKU starts with, from the
 * directory's reference migration (the same rows the API serves), so the categories page stands
 * without the API, as the site does before launch (D-137). The unit test
 * (test/categories-snapshot.test.ts) fails if the two ever disagree; then run:
 *
 *   node apps/web/scripts/category-snapshot.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MIGRATION = fileURLToPath(
  new URL(
    '../../../packages/database/prisma/directory/migrations/20261017130000_reference/migration.sql',
    import.meta.url,
  ),
);
const OUT = fileURLToPath(new URL('../src/features/categories/snapshot.ts', import.meta.url));

export interface SnapshotNode {
  id: string;
  slug: string;
  name: string;
  icon: null;
  children: SnapshotNode[];
}

/** The categories in the migration, as the tree the API returns (active, reviewed, in order). */
export function categoriesFrom(sql: string): SnapshotNode[] {
  const start = sql.indexOf('INSERT INTO "reference"."categories"');
  if (start < 0) throw new Error('category-snapshot: no categories in the migration');
  const block = sql.slice(start, sql.indexOf(';\n', start));
  const row =
    /\((\d+), (NULL|\d+), (\d+), (\d+), (true|false), (true|false), '((?:[^']|'')*)', '((?:[^']|'')*)', '(?:[^']|'')*'\)/g;
  const rows = [...block.matchAll(row)].map((m) => ({
    id: m[1]!,
    parent: m[2] === 'NULL' ? null : m[2]!,
    order: Number(m[4]),
    active: m[5] === 'true' && m[6] === 'false',
    slug: m[7]!.replaceAll("''", "'"),
    name: m[8]!.replaceAll("''", "'"),
  }));
  const live = rows.filter((r) => r.active).sort((a, b) => a.order - b.order);
  const node = (r: (typeof live)[number]): SnapshotNode => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    icon: null,
    children: live.filter((c) => c.parent === r.id).map(node),
  });
  return live.filter((r) => r.parent === null).map(node);
}

export function snapshotSource(tree: SnapshotNode[]): string {
  return `// Written by scripts/category-snapshot.ts from the directory's reference migration. Don't edit.
import type { CategoryNode } from '@/features/search/types';

/** Every kind of place BUKU starts with, for the categories page without the API (D-137). */
export const CATEGORY_SNAPSHOT: CategoryNode[] = ${JSON.stringify(tree, null, 2)};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tree = categoriesFrom(readFileSync(MIGRATION, 'utf8'));
  writeFileSync(OUT, snapshotSource(tree));
  console.log(
    `category-snapshot: ${tree.length} groups, ${tree.reduce((n, g) => n + g.children.length, 0)} kinds → ${OUT}`,
  );
}

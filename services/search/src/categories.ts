import { AppError } from '@buku/common';
import type { CatalogClient } from '@buku/database';

/**
 * The category tree (active categories only), cached briefly: it changes
 * rarely and every search with a category needs it (a category includes its
 * sub-categories: "Beauty & hair" finds barbershops and nail salons).
 *
 * Database v2 (D3h): read from the catalog's copy of the kinds of business (reference data,
 * replicated from the directory, DB-015). IDs are decimal (DB-042).
 */

export interface CategoryNode {
  id: bigint;
  slug: string;
  name: string;
  icon: string | null;
  parentId: bigint | null;
  /** Added by an owner, not reviewed yet (D-098): not in the public list. */
  pending: boolean;
  children: CategoryNode[];
}

const CACHE_MS = 60_000;

export class Categories {
  private cache: { at: number; roots: CategoryNode[]; bySlug: Map<string, CategoryNode> } | null = null;

  constructor(private readonly catalog: CatalogClient) {}

  private async load() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const rows = await this.catalog.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const byId = new Map<bigint, CategoryNode>(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          slug: r.slug,
          name: r.name,
          icon: r.icon,
          parentId: r.parentId,
          pending: r.pending,
          children: [],
        },
      ]),
    );
    const roots: CategoryNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (node.parentId && !parent) continue; // parent switched off: hide the branch
      (parent ? parent.children : roots).push(node);
    }
    // Drop descendants of hidden branches (their parent isn't reachable from a root).
    const reachable = new Map<string, CategoryNode>();
    const walk = (n: CategoryNode) => {
      reachable.set(n.slug, n);
      n.children.forEach(walk);
    };
    roots.forEach(walk);
    this.cache = { at: Date.now(), roots, bySlug: reachable };
    return this.cache;
  }

  /**
   * The public list: kinds that owners added and BUKU hasn't reviewed yet (D-098) are left out,
   * though their businesses are still found when browsing the group above them.
   */
  async tree(): Promise<CategoryNode[]> {
    const listed = (nodes: CategoryNode[]): CategoryNode[] =>
      nodes.filter((n) => !n.pending).map((n) => ({ ...n, children: listed(n.children) }));
    return listed((await this.load()).roots);
  }

  /** The category, or 404. */
  async get(slug: string): Promise<CategoryNode> {
    const node = (await this.load()).bySlug.get(slug);
    if (!node) throw AppError.notFound('Category');
    return node;
  }

  async parentOf(node: CategoryNode): Promise<CategoryNode | null> {
    if (!node.parentId) return null;
    for (const n of (await this.load()).bySlug.values()) if (n.id === node.parentId) return n;
    return null;
  }

  /** The category and everything under it. */
  async idsWithin(slug: string): Promise<bigint[]> {
    const ids: bigint[] = [];
    const walk = (n: CategoryNode) => {
      ids.push(n.id);
      n.children.forEach(walk);
    };
    walk(await this.get(slug));
    return ids;
  }
}

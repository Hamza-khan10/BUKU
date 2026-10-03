import { AppError } from '@buku/common';
import type { Database } from '@buku/database';

/**
 * The category tree (active categories only), cached briefly: it changes
 * rarely and every search with a category needs it (a category includes its
 * sub-categories: "Beauty & hair" finds barbershops and nail salons).
 */

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  parentId: string | null;
  children: CategoryNode[];
}

const CACHE_MS = 60_000;

export class Categories {
  private cache: { at: number; roots: CategoryNode[]; bySlug: Map<string, CategoryNode> } | null = null;

  constructor(private readonly db: Database) {}

  private async load() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const rows = await this.db.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const byId = new Map<string, CategoryNode>(
      rows.map((r) => [
        r.id,
        { id: r.id, slug: r.slug, name: r.name, icon: r.icon, parentId: r.parentId, children: [] },
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

  async tree(): Promise<CategoryNode[]> {
    return (await this.load()).roots;
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
  async idsWithin(slug: string): Promise<string[]> {
    const ids: string[] = [];
    const walk = (n: CategoryNode) => {
      ids.push(n.id);
      n.children.forEach(walk);
    };
    walk(await this.get(slug));
    return ids;
  }
}

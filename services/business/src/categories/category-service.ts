import { randomBytes } from 'node:crypto';
import { AppError, categoryKey, ErrorCodes, type Actor } from '@buku/common';
import { isUniqueViolation, recordShardAudit, type DataPlane } from '@buku/database';
import { auditCtx, type RequestContext } from '../http/context.js';
import { slugify } from '../businesses/slug.js';

/** How many of one person's additions can wait for review at once. */
export const MAX_PENDING_SUGGESTIONS = 3;

type Row = {
  id: bigint;
  name: string;
  slug: string;
  parentId: bigint | null;
  nameKey: string | null;
  isActive: boolean;
  pending: boolean;
};

const view = (c: Row) => ({
  id: c.id.toString(),
  name: c.name,
  slug: c.slug,
  parentId: c.parentId?.toString() ?? null,
  pending: c.pending,
});

/**
 * Kinds of business that owners add when BUKU doesn't list theirs (D-098). A name that means the
 * same as one already on BUKU ("Barber Shops" for "Barbershop") gives back that one instead of a
 * copy; a new one sits under one of BUKU's own groups, is usable at once, and stays out of the
 * public list until BUKU has reviewed it. The name has been cleaned and checked by the route
 * (`zCategoryName`); the unique key settles two owners adding the same kind at the same moment.
 *
 * Database v2: kinds of business are reference data on the directory (DB-015), copied to every
 * business shard and the catalog by replication; they are written and checked there.
 */
export class CategoryService {
  constructor(private readonly plane: DataPlane) {}

  /** A kind a business may use: it exists and BUKU hasn't switched it off (pending ones may). */
  async assertUsable(categoryId: bigint): Promise<void> {
    const ok = await this.plane.directory.category.count({ where: { id: categoryId, isActive: true } });
    if (!ok)
      throw AppError.badRequest('Unknown category', [
        { path: 'categoryId', message: 'unknown or inactive category' },
      ]);
  }

  async suggest(actor: Actor, input: { parentId: bigint; name: string }, ctx: RequestContext) {
    const { directory } = this.plane;
    const key = categoryKey(input.name);
    const parent = await directory.category.findFirst({
      where: { id: input.parentId, depth: 0, isActive: true, pending: false },
      select: { id: true },
    });
    if (!parent) {
      throw AppError.badRequest('Unknown group', [
        { path: 'parentId', message: 'choose one of BUKU’s groups' },
      ]);
    }

    const same = await this.findSame(key);
    if (same) return this.existing(same);

    const waiting = await directory.category.count({ where: { suggestedById: actor.id, pending: true } });
    if (waiting >= MAX_PENDING_SUGGESTIONS) {
      throw AppError.conflict(
        `You have ${MAX_PENDING_SUGGESTIONS} kinds of business waiting for BUKU to review. Please wait for those first.`,
        ErrorCodes.LIMIT_REACHED,
      );
    }

    const base = slugify(input.name) || 'kind';
    for (const slug of [
      base,
      ...Array.from({ length: 4 }, () => `${base}-${randomBytes(2).toString('hex')}`),
    ]) {
      try {
        const created = await directory.category.create({
          data: {
            id: this.plane.id(),
            name: input.name,
            slug,
            nameKey: key,
            parentId: parent.id,
            depth: 1,
            pending: true,
            suggestedById: actor.id,
            sortOrder: 1000,
          },
        });
        // What the person did, with the rest of their account (the directory keeps no audit log).
        await recordShardAudit(await this.plane.user(actor.id), this.plane.id(), {
          userId: actor.id,
          action: 'category.suggested',
          resourceType: 'category',
          resourceId: created.id,
          newValues: { name: created.name, parentId: parent.id.toString() },
          ...auditCtx(ctx),
        });
        return { category: view(created), existing: false };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Someone added the same kind a moment ago: use theirs. Otherwise the slug was taken.
        const raced = await this.findSame(key);
        if (raced) return this.existing(raced);
      }
    }
    throw AppError.internal('Could not allocate a category address');
  }

  /** The category that means the same, whatever its state (rows made before keys get one here). */
  private async findSame(key: string): Promise<Row | null> {
    const { directory } = this.plane;
    const byKey = await directory.category.findUnique({ where: { nameKey: key } });
    if (byKey) return byKey;
    const unkeyed = await directory.category.findMany({ where: { nameKey: null } });
    return unkeyed.find((c) => categoryKey(c.name) === key) ?? null;
  }

  private existing(c: Row) {
    if (!c.isActive) {
      throw AppError.conflict('BUKU doesn’t list that kind of business.', ErrorCodes.CATEGORY_UNAVAILABLE);
    }
    return { category: view(c), existing: true };
  }
}

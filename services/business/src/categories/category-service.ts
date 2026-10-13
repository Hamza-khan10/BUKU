import { randomBytes } from 'node:crypto';
import { AppError, categoryKey, ErrorCodes } from '@buku/common';
import { isUniqueViolation, recordAudit, type Database } from '@buku/database';
import { auditCtx, type RequestContext } from '../http/context.js';
import { slugify } from '../businesses/slug.js';

/** How many of one person's additions can wait for review at once. */
export const MAX_PENDING_SUGGESTIONS = 3;

type Row = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  nameKey: string | null;
  isActive: boolean;
  pending: boolean;
};

const view = (c: Row) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, pending: c.pending });

/**
 * Kinds of business that owners add when BUKU doesn't list theirs (D-098). A name that means the
 * same as one already on BUKU ("Barber Shops" for "Barbershop") gives back that one instead of a
 * copy; a new one sits under one of BUKU's own groups, is usable at once, and stays out of the
 * public list until BUKU has reviewed it. The name has been cleaned and checked by the route
 * (`zCategoryName`); the unique key settles two owners adding the same kind at the same moment.
 */
export class CategoryService {
  constructor(private readonly db: Database) {}

  async suggest(userId: string, input: { parentId: string; name: string }, ctx: RequestContext) {
    const key = categoryKey(input.name);
    const parent = await this.db.category.findFirst({
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

    const waiting = await this.db.category.count({ where: { suggestedById: userId, pending: true } });
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
        const created = await this.db.$transaction(async (tx) => {
          const row = await tx.category.create({
            data: {
              name: input.name,
              slug,
              nameKey: key,
              parentId: parent.id,
              depth: 1,
              pending: true,
              suggestedById: userId,
              sortOrder: 1000,
            },
          });
          await recordAudit(tx, {
            userId,
            action: 'category.suggested',
            resourceType: 'category',
            resourceId: row.id,
            newValues: { name: row.name, parentId: parent.id },
            ...auditCtx(ctx),
          });
          return row;
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
    const byKey = await this.db.category.findUnique({ where: { nameKey: key } });
    if (byKey) return byKey;
    const unkeyed = await this.db.category.findMany({ where: { nameKey: null } });
    return unkeyed.find((c) => categoryKey(c.name) === key) ?? null;
  }

  private existing(c: Row) {
    if (!c.isActive) {
      throw AppError.conflict('BUKU doesn’t list that kind of business.', ErrorCodes.CATEGORY_UNAVAILABLE);
    }
    return { category: view(c), existing: true };
  }
}

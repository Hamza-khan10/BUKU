import { Prisma } from './generated/prisma/client.js';

/**
 * Soft-deleted users (deleted_at IS NOT NULL) are invisible to normal reads.
 *
 * Every top-level `user` read gets `deletedAt: null` added to its WHERE —
 * including reads with no WHERE at all. To deliberately see deleted users
 * (admin tools, the GDPR purge job), state it explicitly in the query:
 *
 *   where: { deletedAt: { not: null } }   // only deleted users
 *   where: { deletedAt: undefined }       // everyone (explicit opt-out)
 *
 * Limitation (inherent to Prisma extensions): users reached through a
 * RELATION (e.g. `appointment.include.user`) are not filtered. Services must
 * not expose deleted users' data through relations; the deletion flow
 * anonymizes the row's PII after the grace period.
 */
const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

export const softDeleteUsers = Prisma.defineExtension({
  name: 'soft-delete-users',
  query: {
    user: {
      $allOperations({ operation, args, query }) {
        if (READ_OPERATIONS.has(operation)) {
          const a = args as { where?: Record<string, unknown> };
          if (!a.where || !('deletedAt' in a.where)) {
            a.where = { ...a.where, deletedAt: null };
          }
        }
        return query(args);
      },
    },
  },
});

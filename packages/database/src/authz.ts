import { AppError, can, ErrorCodes, type BusinessPermission, type BusinessRole } from '@buku/common';
import type { Database, Transaction } from './index.js';

/**
 * Resolve a user's role in a business, straight from the database on every
 * call — so a removed or disabled employee loses access immediately, with no
 * stale role cached in a token. Deleted businesses grant no role at all, and
 * neither does an employee account still on its temporary password (D-034):
 * whoever saw that password must not be able to act for the business.
 */
export async function businessRoleOf(
  db: Database | Transaction,
  businessId: string,
  userId: string,
): Promise<BusinessRole | null> {
  const business = await db.business.findFirst({
    where: { id: businessId, deletedAt: null },
    select: {
      ownerId: true,
      members: {
        where: { userId, status: 'active', user: { mustChangePassword: false } },
        select: { role: true },
        take: 1,
      },
    },
  });
  if (!business) return null;
  if (business.ownerId === userId) return 'owner';
  return business.members[0]?.role ?? null;
}

/**
 * Throw unless the user may perform `permission` in the business.
 *  • no role at all          → 404 (don't confirm what they can't manage)
 *  • role without permission → 403
 */
export async function requireBusinessPermission(
  db: Database | Transaction,
  businessId: string,
  userId: string,
  permission: BusinessPermission,
): Promise<BusinessRole> {
  const role = await businessRoleOf(db, businessId, userId);
  if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
  if (!can(role, permission)) throw AppError.forbidden();
  return role;
}

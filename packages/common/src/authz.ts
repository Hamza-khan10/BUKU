/**
 * Business-level authorization: WHO may do WHAT inside a business.
 *
 * Platform roles (in the JWT: user / super_admin) say what someone may do on
 * BUKU as a whole. Business roles say what they may do in ONE business —
 * the same person can own one business and be front desk at another. The
 * owner is `businesses.owner_id`; everyone else is a `business_members` row.
 *
 * This table is the single source of truth: every service checks
 * permissions through `can()` / `requireBusinessPermission()`, never by
 * comparing role names inline.
 */
export const BUSINESS_ROLES = ['owner', 'manager', 'front_desk', 'staff'] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const BUSINESS_PERMISSIONS = {
  /** See the private management view (status, settings, rejection reason). */
  'business.view_private': ['owner', 'manager', 'front_desk', 'staff'],
  /** Edit the public profile. */
  'business.update': ['owner', 'manager'],
  'business.hours': ['owner', 'manager'],
  /** Legal/registration details and verification documents (KYB). */
  'business.legal': ['owner'],
  'business.media': ['owner', 'manager'],
  /** Create and manage employee accounts (managers: front desk and staff only). */
  'members.manage': ['owner', 'manager'],
  'appointments.manage_all': ['owner', 'manager', 'front_desk'],
  'queue.operate': ['owner', 'manager', 'front_desk'],
  'schedule.manage_all': ['owner', 'manager'],
  'schedule.manage_own': ['owner', 'manager', 'front_desk', 'staff'],
  'billing.manage': ['owner'],
} as const satisfies Record<string, readonly BusinessRole[]>;

export type BusinessPermission = keyof typeof BUSINESS_PERMISSIONS;

export function can(role: BusinessRole | null | undefined, permission: BusinessPermission): boolean {
  return role != null && (BUSINESS_PERMISSIONS[permission] as readonly BusinessRole[]).includes(role);
}

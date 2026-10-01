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
  /** Service menu: categories, services, prices, durations. */
  'services.manage': ['owner', 'manager'],
  /** Staff profiles (who can be booked) and which services each person does. */
  'staff.manage': ['owner', 'manager'],
  /** Booking settings: confirmation mode, horizon, limits, cancellation window. */
  'booking.settings': ['owner', 'manager'],
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

/** Roles a person can be given as a member (owner is not a member role). */
export const MEMBER_ROLES = ['manager', 'front_desk', 'staff'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Which member roles each business role may create and manage
 * (`members.manage`): the owner manages everyone, a manager only front desk
 * and staff — so a manager can never promote anyone, or themselves, to manager.
 */
export const MANAGEABLE_ROLES = {
  owner: ['manager', 'front_desk', 'staff'],
  manager: ['front_desk', 'staff'],
  front_desk: [],
  staff: [],
} as const satisfies Record<BusinessRole, readonly MemberRole[]>;

export function canManageRole(actor: BusinessRole, target: MemberRole): boolean {
  return (MANAGEABLE_ROLES[actor] as readonly MemberRole[]).includes(target);
}

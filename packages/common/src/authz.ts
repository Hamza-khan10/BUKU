// Who may do what inside a business lives in @buku/validation (browser-safe), so the website shows
// each person exactly the tools the API lets them use. The API enforces it either way.
export {
  BUSINESS_PERMISSIONS,
  BUSINESS_ROLES,
  can,
  canManageRole,
  MANAGEABLE_ROLES,
  MEMBER_ROLES,
  type BusinessPermission,
  type BusinessRole,
  type MemberRole,
} from '@buku/validation';

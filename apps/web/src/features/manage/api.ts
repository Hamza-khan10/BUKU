import type { ServiceItem, StaffMember } from '@/features/business/types';
import { can, MANAGEABLE_ROLES } from '@buku/validation';
import { api } from '@/lib/api/client';
import { uploadFile } from '@/lib/api/upload';
import type { OpeningHours } from '@/lib/format';
import type { Range } from './setup';

/**
 * The business area's calls (3.5): every one through our own server, which adds the session.
 * The API decides who may do what (owner, manager, front desk, staff); these only ask.
 */

export type TeamRole = 'owner' | 'manager' | 'front_desk' | 'staff';
export type BusinessStatus = 'pending' | 'verified' | 'rejected' | 'suspended';

/** A business as its team sees it (GET /v1/businesses/mine and …/:id/manage). */
export interface ManagedBusiness {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: { id: string; name: string; slug: string };
  contact: { phone: string | null; email: string | null; website: string | null };
  address: { line: string; city: string; state: string | null; country: string; postalCode: string | null };
  location: { lat: number; lng: number } | null;
  timezone: string;
  currency: string;
  hours: OpeningHours[];
  logoUrl: string | null;
  photos: { id: string; url: string; altText: string | null; isPrimary: boolean }[];
  myRole: TeamRole;
  status: BusinessStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A staff profile as the team sees it (inactive ones included). */
export interface ManagedStaff extends StaffMember {
  userId: string | null;
  isActive: boolean;
}

/** A service as the team sees it: archived ones too, with their clean-up time. */
export interface ManagedService extends ServiceItem {
  bufferMinutes: number;
  sortOrder: number;
  isActive: boolean;
}

/** The whole menu, by group; services without a group come last (`id: null`). */
export interface ManagedMenu {
  categories: { id: string | null; name: string; sortOrder: number; services: ManagedService[] }[];
}

/** A team login (GET /v1/businesses/:id/members). */
export interface Member {
  id: string;
  userId: string;
  name: string;
  role: Exclude<TeamRole, 'owner'>;
  status: 'active' | 'disabled';
  accountType: 'employee' | 'personal';
  username: string | null;
  /** Still on the temporary password: no access to the business until they change it. */
  passwordChangePending: boolean;
  locked: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

export const MINE_KEY = ['business', 'mine'] as const;
export const managedKey = (id: string) => ['business', id, 'manage'] as const;
export const menuKey = (id: string) => ['business', id, 'services'] as const;
export const staffKey = (id: string) => ['business', id, 'staff'] as const;
export const membersKey = (id: string) => ['business', id, 'members'] as const;
export const staffHoursKey = (id: string, staffId: string) =>
  ['business', id, 'staff', staffId, 'hours'] as const;

export const fetchMine = () => api<ManagedBusiness[]>('businesses/mine');
export const fetchManaged = (id: string) => api<ManagedBusiness>(`businesses/${id}/manage`);
export const fetchMenu = (id: string) => api<ManagedMenu>(`businesses/${id}/services/manage`);
export const fetchStaff = (id: string) => api<ManagedStaff[]>(`businesses/${id}/staff/manage`);

export interface NewBusiness {
  name: string;
  categoryId: string;
  description?: string;
  phone?: string;
  email?: string;
  website?: string;
  address: string;
  city: string;
  state?: string;
  country: string;
  postalCode?: string;
  lat: number;
  lng: number;
  timezone: string;
  currency: string;
  acceptedBusinessTermsVersion: string;
}

/** Register a business. Safe to send twice (the key makes a retry answer like the first). */
export const createBusiness = (input: NewBusiness, idempotencyKey: string) =>
  api<ManagedBusiness>('businesses', { method: 'POST', body: input, idempotencyKey });

export const setOpeningHours = (id: string, hours: OpeningHours[]) =>
  api<ManagedBusiness>(`businesses/${id}/hours`, { method: 'PUT', body: { hours } });

// ── The menu ──────────────────────────────────────────────────────────────────

export interface NewService {
  name: string;
  durationMinutes: number;
  price: number;
  description?: string | null;
  categoryId?: string | null;
  bufferMinutes?: number;
  staffIds?: string[];
}

export const createService = (id: string, input: NewService) =>
  api<ManagedService>(`businesses/${id}/services`, { method: 'POST', body: input });

export const updateService = (
  id: string,
  serviceId: string,
  change: Partial<NewService> & { isActive?: boolean },
) => api<ManagedService>(`businesses/${id}/services/${serviceId}`, { method: 'PATCH', body: change });

/** Archived, not deleted: past visits keep pointing at it, and it can be brought back. */
export const archiveService = (id: string, serviceId: string) =>
  api<void>(`businesses/${id}/services/${serviceId}`, { method: 'DELETE' });

export const createGroup = (id: string, name: string) =>
  api<{ id: string; name: string; sortOrder: number }>(`businesses/${id}/service-categories`, {
    method: 'POST',
    body: { name },
  });

// ── People customers can book (staff profiles) ────────────────────────────────

export interface NewStaff {
  displayName: string;
  bio?: string | null;
  userId?: string | null;
  serviceIds: string[];
}

export const createStaff = (id: string, input: NewStaff) =>
  api<ManagedStaff>(`businesses/${id}/staff`, { method: 'POST', body: input });

export const updateStaff = (
  id: string,
  staffId: string,
  change: Partial<NewStaff> & { isActive?: boolean },
) => api<ManagedStaff>(`businesses/${id}/staff/${staffId}`, { method: 'PATCH', body: change });

/** Off the booking list (their history stays); they can be brought back. */
export const deactivateStaff = (id: string, staffId: string) =>
  api<void>(`businesses/${id}/staff/${staffId}`, { method: 'DELETE' });

export const fetchStaffHours = (id: string, staffId: string) =>
  api<{ dayOfWeek: number; ranges: Range[] }[]>(`businesses/${id}/staff/${staffId}/hours`);

export const setStaffHours = (id: string, staffId: string, days: { dayOfWeek: number; ranges: Range[] }[]) =>
  api<unknown>(`businesses/${id}/staff/${staffId}/hours`, { method: 'PUT', body: { days } });

/** Their photo, only with their agreement (D-051); they can remove it themselves. */
export const uploadStaffPhoto = (id: string, staffId: string, file: File, type: string) =>
  uploadFile<{ staffId: string; photoUrl: string }>(
    `businesses/${id}/staff/${staffId}/photo/uploads`,
    { consentConfirmed: true },
    file,
    type,
  );

export const removeStaffPhoto = (id: string, staffId: string) =>
  api<unknown>(`businesses/${id}/staff/${staffId}/photo`, { method: 'DELETE' });

// ── Logins (team accounts) ────────────────────────────────────────────────────

export const fetchMembers = (id: string) => api<Member[]>(`businesses/${id}/members`);

export const createMember = (id: string, input: { name: string; username: string; role: Member['role'] }) =>
  api<{ member: Member; temporaryPassword: string }>(`businesses/${id}/members`, {
    method: 'POST',
    body: input,
  });

export const updateMember = (
  id: string,
  memberId: string,
  change: { name?: string; role?: Member['role']; status?: Member['status'] },
) => api<Member>(`businesses/${id}/members/${memberId}`, { method: 'PATCH', body: change });

/** A new temporary password (it also unlocks them, and signs them out everywhere). */
export const resetMemberPassword = (id: string, memberId: string) =>
  api<{ temporaryPassword: string }>(`businesses/${id}/members/${memberId}/reset-password`, {
    method: 'POST',
  });

export const removeMember = (id: string, memberId: string) =>
  api<void>(`businesses/${id}/members/${memberId}`, { method: 'DELETE' });

// ── Pictures: the logo, and photos (the first is the cover) ──────────────────

export type BusinessPhoto = ManagedBusiness['photos'][number];

/** Every business can have up to 20 photos (the API refuses more). */
export const MAX_PHOTOS = 20;

/** A new logo (it replaces the old one); the API cleans it and answers with its link. */
export const uploadLogo = (id: string, file: File, type: string) =>
  uploadFile<{ logoUrl: string }>(`businesses/${id}/logo/uploads`, {}, file, type);

export const removeLogo = (id: string) => api<void>(`businesses/${id}/logo`, { method: 'DELETE' });

/** A new photo, described for people who can't see it; the answer is the whole gallery, cover first. */
export const uploadPhoto = (id: string, file: File, type: string, altText: string | undefined) =>
  uploadFile<BusinessPhoto[]>(`businesses/${id}/photos/uploads`, altText ? { altText } : {}, file, type);

export const makeCover = (id: string, photoId: string) =>
  api<BusinessPhoto[]>(`businesses/${id}/photos/${photoId}/primary`, { method: 'POST' });

export const removePhoto = (id: string, photoId: string) =>
  api<BusinessPhoto[]>(`businesses/${id}/photos/${photoId}`, { method: 'DELETE' });

/** What each role is for, said plainly (the API enforces it). */
export const ROLE_TEXT: Record<Member['role'], string> = {
  manager: 'Runs the business with you: services, team, settings. Can’t change billing or legal details.',
  front_desk: 'Takes bookings and runs the queue at the desk.',
  staff: 'Sees and manages their own visits and hours.',
};

/** Roles, as people say them. */
export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  front_desk: 'Front desk',
  staff: 'Staff',
};

/** Who may change the business's set-up (the API says the same: owner and manager). */
export const canSetUp = (role: TeamRole) => can(role, 'services.manage');

export { can, MANAGEABLE_ROLES };

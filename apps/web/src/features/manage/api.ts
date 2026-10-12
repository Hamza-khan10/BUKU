import type { ServiceItem, ServiceMenu, StaffMember } from '@/features/business/types';
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
  isActive?: boolean;
}

export const MINE_KEY = ['business', 'mine'] as const;
export const managedKey = (id: string) => ['business', id, 'manage'] as const;
export const menuKey = (id: string) => ['business', id, 'services'] as const;
export const staffKey = (id: string) => ['business', id, 'staff'] as const;

export const fetchMine = () => api<ManagedBusiness[]>('businesses/mine');
export const fetchManaged = (id: string) => api<ManagedBusiness>(`businesses/${id}/manage`);
export const fetchMenu = (id: string) => api<ServiceMenu>(`businesses/${id}/services/manage`);
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

export interface NewService {
  name: string;
  durationMinutes: number;
  price: number;
  staffIds?: string[];
}

export const createService = (id: string, input: NewService) =>
  api<ServiceItem>(`businesses/${id}/services`, { method: 'POST', body: input });

export interface NewStaff {
  displayName: string;
  userId?: string;
  serviceIds: string[];
}

export const createStaff = (id: string, input: NewStaff) =>
  api<ManagedStaff>(`businesses/${id}/staff`, { method: 'POST', body: input });

export const updateStaff = (id: string, staffId: string, change: { serviceIds: string[] }) =>
  api<ManagedStaff>(`businesses/${id}/staff/${staffId}`, { method: 'PATCH', body: change });

export const setStaffHours = (id: string, staffId: string, days: { dayOfWeek: number; ranges: Range[] }[]) =>
  api<unknown>(`businesses/${id}/staff/${staffId}/hours`, { method: 'PUT', body: { days } });

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

/** Roles, as people say them. */
export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  front_desk: 'Front desk',
  staff: 'Staff',
};

/** Who may change the business's set-up (the API says the same: owner and manager). */
export const canSetUp = (role: TeamRole) => role === 'owner' || role === 'manager';

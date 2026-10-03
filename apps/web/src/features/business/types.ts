/** The public business data the profile page shows (shapes of the API's public answers). */

import type { OpeningHours } from '@/lib/format';

export interface BusinessProfile {
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
  verification: { status: 'pending' | 'verified'; label: string; verifiedAt: string | null };
  rating: { average: number; count: number };
  /** How reliably the business keeps its bookings (null until there's enough to say). */
  reliability: { keptPercent: number; basedOn: number } | null;
  hours: OpeningHours[];
  createdAt: string;
  logoUrl: string | null;
  photos: { id: string; url: string; altText: string | null; isPrimary: boolean }[];
  team: { id: string; displayName: string; photoUrl: string | null }[];
}

export interface ServiceItem {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: string;
  currency: string;
  staffIds: string[];
}

export interface ServiceMenu {
  businessId: string;
  currency: string;
  categories: { id: string | null; name: string; sortOrder: number; services: ServiceItem[] }[];
  booking: {
    confirmationMode: 'automatic' | 'manual';
    bookingHorizonDays: number;
    cancellationWindowHours: number;
    minNoticeMinutes: number;
  };
}

export interface StaffMember {
  id: string;
  displayName: string;
  bio: string | null;
  specializations: string[];
  photoUrl: string | null;
  serviceIds: string[];
}

export interface Review {
  id: string;
  rating: { overall: number; waitTime?: number; staff?: number; cleanliness?: number; value?: number };
  comment: string | null;
  author: string;
  service: string | null;
  staff: string | null;
  visitedIn: string;
  createdAt: string;
  edited: boolean;
  /** The business's public reply. */
  response: { text: string; at: string | null } | null;
}

export interface ReviewsMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  summary: {
    average: number;
    count: number;
    stars: Record<'1' | '2' | '3' | '4' | '5', number>;
    details: {
      waitTime: number | null;
      staff: number | null;
      cleanliness: number | null;
      value: number | null;
    };
  };
}

export type QueueState =
  | { businessId: string; status: 'closed'; remoteJoinRadiusMeters: number }
  | {
      businessId: string;
      status: 'open' | 'paused';
      remoteJoinRadiusMeters: number;
      waiting: number;
      line: string[];
      called: string[];
      serving: string[];
      estimatedWaitMinutes: number | null;
      avgServiceSeconds: number;
    };

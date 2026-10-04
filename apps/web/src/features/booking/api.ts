import { api, apiCall } from '@/lib/api/client';
import type { Availability, Receipt } from './types';

/** Free start times for a service (and a person, or anyone), `days` days from `date`. Never cached. */
export function fetchAvailability(
  business: string,
  q: { serviceId: string; staffId: string | null; date: string; days: number },
) {
  return api<Availability>(`businesses/${business}/availability`, {
    query: { serviceId: q.serviceId, date: q.date, days: q.days, ...(q.staffId && { staffId: q.staffId }) },
  });
}

export interface BookingRequest {
  businessId: string;
  serviceId: string;
  staffId: string | null;
  startAt: string;
  notes?: string | undefined;
}

/** Book one of the offered times → the receipt. */
export function book(request: BookingRequest) {
  return api<Receipt>('appointments', {
    method: 'POST',
    body: {
      businessId: request.businessId,
      serviceId: request.serviceId,
      ...(request.staffId && { staffId: request.staffId }),
      startAt: request.startAt,
      ...(request.notes && { notes: request.notes }),
    },
  });
}

export const RECEIPT_KEY = (id: string) => ['receipt', id] as const;

export const fetchReceipt = (id: string) => api<Receipt>(`appointments/${id}`);

/** My upcoming visits (most recent first page). */
export const fetchUpcoming = (limit = 20) =>
  apiCall<Receipt[]>('appointments', { query: { scope: 'upcoming', limit } }).then((r) => r.data);

// ── My visits ─────────────────────────────────────────────────────────────

export interface VisitsPage {
  items: Receipt[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const VISITS_KEY = (scope: 'upcoming' | 'past') => ['visits', scope] as const;

/** Upcoming (soonest first) or past (latest first) visits, a page at a time. */
export async function fetchVisits(scope: 'upcoming' | 'past', page: number, limit = 10): Promise<VisitsPage> {
  const res = await apiCall<Receipt[], VisitsPage['meta']>('appointments', { query: { scope, page, limit } });
  return { items: res.data, meta: res.meta ?? { page, limit, total: res.data.length, totalPages: 1 } };
}

export type CancelReason =
  'schedule_conflict' | 'found_alternative' | 'too_expensive' | 'not_needed' | 'illness' | 'other';

/** Cancel my visit; `bookLater` asks for a "book again?" reminder in a few days. */
export function cancelVisit(
  id: string,
  input: { reasonCode: CancelReason; note?: string; bookLater?: boolean },
) {
  return api<Receipt>(`appointments/${id}/cancel`, { method: 'POST', body: input });
}

/** Move my visit (same service) to another offered time → the new booking, with a new code. */
export function moveVisit(id: string, input: { startAt: string; staffId?: string | null }) {
  return api<Receipt>(`appointments/${id}/reschedule`, {
    method: 'POST',
    body: { startAt: input.startAt, ...(input.staffId && { staffId: input.staffId }) },
  });
}

/** How reliably I keep my bookings (what businesses see is only the label). */
export interface Reliability {
  showsUpPercent: number | null;
  basedOn: number;
  label: string;
  visits: number;
  noShows: number;
  lateCancellations: number;
  businessesSee: string;
  tip: string;
}

export const RELIABILITY_KEY = ['reliability'] as const;
export const fetchReliability = () => api<Reliability>('appointments/reliability');

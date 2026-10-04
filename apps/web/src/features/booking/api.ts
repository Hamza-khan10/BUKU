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

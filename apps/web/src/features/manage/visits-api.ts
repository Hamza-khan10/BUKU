import { api } from '@/lib/api/client';
import type { Visit, VisitList, VisitQuery } from './visits';

/** A business's visits through our own server (3.5b): lists, search, and each step at the desk. */

export const visitsKey = (id: string, query: VisitQuery = {}) =>
  [
    'business',
    id,
    'visits',
    query.date ?? 'today',
    query.staffId ?? '',
    query.status ?? '',
    query.q ?? '',
  ] as const;
export const allVisitsKey = (id: string) => ['business', id, 'visits'] as const;

export function fetchVisits(id: string, query: VisitQuery = {}) {
  const params = new URLSearchParams();
  for (const key of ['date', 'staffId', 'status', 'q'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return api<VisitList>(`businesses/${id}/appointments${qs ? `?${qs}` : ''}`);
}

const visitPath = (id: string, visitId: string) => `businesses/${id}/appointments/${visitId}`;
export const confirmVisit = (id: string, visitId: string) =>
  api<Visit>(`${visitPath(id, visitId)}/confirm`, { method: 'POST' });
export const declineVisit = (id: string, visitId: string, reason: string | undefined) =>
  api<Visit>(`${visitPath(id, visitId)}/decline`, { method: 'POST', body: reason ? { reason } : {} });
export const cancelVisit = (id: string, visitId: string, reason: string) =>
  api<Visit>(`${visitPath(id, visitId)}/cancel`, { method: 'POST', body: { reason } });
export const checkInVisit = (id: string, visitId: string) =>
  api<Visit>(`${visitPath(id, visitId)}/check-in`, { method: 'POST' });
export const completeVisit = (id: string, visitId: string) =>
  api<Visit>(`${visitPath(id, visitId)}/complete`, { method: 'POST' });
export const noShowVisit = (id: string, visitId: string) =>
  api<Visit>(`${visitPath(id, visitId)}/no-show`, { method: 'POST' });
/** Scanned from the receipt's QR or typed; case doesn't matter. */
export const checkInByCode = (id: string, code: string) =>
  api<Visit>(`businesses/${id}/check-in`, { method: 'POST', body: { code } });

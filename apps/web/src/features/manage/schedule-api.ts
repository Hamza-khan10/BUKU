import { api } from '@/lib/api/client';
import type { ScheduleEntry, ScheduleInput } from './schedule';

/** Closed days and people's time off through our own server (3.5e). */

export const closuresKey = (id: string) => ['business', id, 'closures'] as const;

export const fetchClosures = (id: string) => api<ScheduleEntry[]>(`businesses/${id}/closures`);
export const addClosure = (id: string, input: ScheduleInput) =>
  api<ScheduleEntry[]>(`businesses/${id}/closures`, { method: 'POST', body: input });
export const removeClosure = (id: string, closureId: string) =>
  api<null>(`businesses/${id}/closures/${closureId}`, { method: 'DELETE' });

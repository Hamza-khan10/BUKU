import { api } from '@/lib/api/client';
import type { EntryKind, ScheduleEntry, ScheduleInput } from './schedule';

/** Closed days (3.5e) and people's time off (3.5f) through our own server. */

export const closuresKey = (id: string) => ['business', id, 'closures'] as const;

export const fetchClosures = (id: string) => api<ScheduleEntry[]>(`businesses/${id}/closures`);
export const addClosure = (id: string, input: ScheduleInput) =>
  api<ScheduleEntry[]>(`businesses/${id}/closures`, { method: 'POST', body: input });
export const removeClosure = (id: string, closureId: string) =>
  api<null>(`businesses/${id}/closures/${closureId}`, { method: 'DELETE' });

export const timeOffKey = (id: string, staffId: string) => ['business', id, 'time-off', staffId] as const;

export const fetchTimeOff = (id: string, staffId: string) =>
  api<ScheduleEntry[]>(`businesses/${id}/staff/${staffId}/time-off`);
export const addTimeOff = (id: string, staffId: string, input: ScheduleInput & { kind: EntryKind }) =>
  api<ScheduleEntry[]>(`businesses/${id}/staff/${staffId}/time-off`, { method: 'POST', body: input });
export const removeTimeOff = (id: string, staffId: string, entryId: string) =>
  api<null>(`businesses/${id}/staff/${staffId}/time-off/${entryId}`, { method: 'DELETE' });

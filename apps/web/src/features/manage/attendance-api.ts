import { api } from '@/lib/api/client';
import type { Present, Shift, ShiftDay } from './attendance';

/** Clocking in and out, and the day's shifts, through our own server (3.5g). */

export const attendanceKey = (id: string) => ['business', id, 'attendance'] as const;
export const shiftsKey = (id: string, date: string) => ['business', id, 'attendance', 'day', date] as const;
export const presentKey = (id: string) => ['business', id, 'attendance', 'present'] as const;

export const fetchShifts = (id: string, date: string) =>
  api<ShiftDay>(`businesses/${id}/attendance?date=${encodeURIComponent(date)}`);
export const fetchPresent = (id: string) => api<Present[]>(`businesses/${id}/attendance/present`);

export const clockIn = (id: string, staffId: string) =>
  api<Shift>(`businesses/${id}/staff/${staffId}/attendance/check-in`, { method: 'POST', body: {} });
export const clockOut = (id: string, staffId: string) =>
  api<Shift>(`businesses/${id}/staff/${staffId}/attendance/check-out`, { method: 'POST' });

/** A manager fixes a forgotten or wrong clock-in or -out (audited with the old and new times). */
export const correctShift = (
  id: string,
  shiftId: string,
  changes: { checkInAt?: string; checkOutAt?: string; note?: string },
) => api<Shift>(`businesses/${id}/attendance/${shiftId}`, { method: 'PATCH', body: changes });

import { api } from '@/lib/api/client';
import type { ManagedBusiness } from './api';
import type { BookingSettings, ProfileChange, QueueSettings } from './settings';

/** Settings (3.5l): read by every team role; changed by the owner and managers. */

export const bookingSettingsKey = (id: string) => ['business', id, 'booking-settings'] as const;
export const queueSettingsKey = (id: string) => ['business', id, 'queue-settings'] as const;

export const updateProfile = (id: string, change: ProfileChange) =>
  api<ManagedBusiness>(`businesses/${id}`, { method: 'PATCH', body: change });

export const fetchBookingSettings = (id: string) => api<BookingSettings>(`businesses/${id}/booking-settings`);
export const saveBookingSettings = (id: string, change: Partial<BookingSettings>) =>
  api<BookingSettings>(`businesses/${id}/booking-settings`, { method: 'PUT', body: change });

export const fetchQueueSettings = (id: string) => api<QueueSettings>(`businesses/${id}/queue/settings`);
export const saveQueueSettings = (id: string, change: Partial<QueueSettings>) =>
  api<QueueSettings>(`businesses/${id}/queue/settings`, { method: 'PUT', body: change });

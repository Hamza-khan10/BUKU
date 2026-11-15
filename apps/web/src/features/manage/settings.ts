import type { BusinessStatus, ManagedBusiness } from './api';

/**
 * Settings (3.5l): the business's profile, how bookings work and how the queue works. The rules
 * mirror the services' (business, booking, queue), so the page warns before the API acts.
 */

/** What the profile form edits. Empty text means "none" for the optional fields. */
export interface ProfileDraft {
  name: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  place: { lat: number; lng: number } | null;
}

export function profileDraft(b: ManagedBusiness): ProfileDraft {
  return {
    name: b.name,
    description: b.description ?? '',
    phone: b.contact.phone ?? '',
    email: b.contact.email ?? '',
    website: b.contact.website ?? '',
    address: b.address.line,
    city: b.address.city,
    state: b.address.state ?? '',
    postalCode: b.address.postalCode ?? '',
    place: b.location,
  };
}

/** PATCH /v1/businesses/:id: only the fields given are changed. */
export type ProfileChange = Partial<{
  name: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
}>;

/**
 * Only what changed, trimmed. The API can't empty an optional field (an absent field means "keep
 * it"), so clearing one is refused here with the reason, rather than silently kept.
 */
export function profileChanges(
  before: ProfileDraft,
  after: ProfileDraft,
): { change: ProfileChange; cleared: (keyof ProfileDraft)[] } {
  const change: ProfileChange = {};
  const cleared: (keyof ProfileDraft)[] = [];
  const texts = [
    'name',
    'description',
    'phone',
    'email',
    'website',
    'address',
    'city',
    'state',
    'postalCode',
  ] as const;
  for (const key of texts) {
    const was = before[key].trim();
    const now = after[key].trim();
    if (was === now) continue;
    if (!now) cleared.push(key);
    else change[key] = now;
  }
  const a = before.place;
  const b = after.place;
  if (b && (!a || a.lat !== b.lat || a.lng !== b.lng)) {
    change.lat = b.lat;
    change.lng = b.lng;
  }
  return { change, cleared };
}

/** What BUKU checked when it verified the business; changing any of it sends it back to review. */
const IDENTITY: readonly (keyof ProfileChange)[] = [
  'name',
  'address',
  'city',
  'state',
  'postalCode',
  'lat',
  'lng',
];

/** Would saving this send the business back to review (it was verified, or rejected and fixed)? */
export function reverifies(change: ProfileChange, status: BusinessStatus): boolean {
  return (status === 'verified' || status === 'rejected') && IDENTITY.some((k) => change[k] !== undefined);
}

// ── How bookings work (GET/PUT /v1/businesses/:id/booking-settings) ─────────

export interface BookingSettings {
  confirmationMode: 'automatic' | 'manual';
  bookingHorizonDays: number;
  maxFutureBookingsPerCustomer: number;
  cancellationWindowHours: number;
  minNoticeMinutes: number;
  slotStepMinutes: 5 | 10 | 15 | 20 | 30 | 60;
  noShowGraceMinutes: number;
  /** Ask to approve bookings from customers who show up less than this often; null: off. */
  approvalBelowShowUpPercent: number | null;
}

export const SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const;

/** The API's limits, so the form says what's allowed before it asks. */
export const BOOKING_LIMITS = {
  bookingHorizonDays: { min: 1, max: 1825 },
  maxFutureBookingsPerCustomer: { min: 1, max: 20 },
  cancellationWindowHours: { min: 0, max: 168 },
  minNoticeMinutes: { min: 0, max: 10080 },
  noShowGraceMinutes: { min: 0, max: 240 },
  approvalBelowShowUpPercent: { min: 50, max: 99 },
} as const;

// ── How the queue works (GET/PUT /v1/businesses/:id/queue/settings) ─────────

export interface QueueSettings {
  remoteJoinRadiusMeters: number;
  maxQueueSize: number;
  gracePeriodSeconds: number;
  ticketPrefix: string;
  avgServiceSeconds: number;
}

export const QUEUE_LIMITS = {
  remoteJoinRadiusMeters: { min: 100, max: 100_000 },
  maxQueueSize: { min: 1, max: 10_000 },
  gracePeriodSeconds: { min: 0, max: 3600 },
  avgServiceSeconds: { min: 30, max: 14_400 },
} as const;

/** 1–3 letters, as the queue's tickets start ("A" → A-12). */
export const TICKET_PREFIX = /^[A-Za-z]{1,3}$/;

/**
 * A whole number from a form field within [min, max], or the problem in words. Only digits:
 * "1e3", "12.5", "-3" and spaces inside are refused.
 */
export function wholeNumber(
  raw: string,
  { min, max }: { min: number; max: number },
): { ok: true; value: number } | { ok: false; message: string } {
  const text = raw.trim();
  if (!/^\d{1,7}$/.test(text)) return { ok: false, message: `Enter a whole number from ${min} to ${max}.` };
  const value = Number(text);
  if (value < min || value > max)
    return { ok: false, message: `Enter a whole number from ${min} to ${max}.` };
  return { ok: true, value };
}

/** Only the settings that changed (the APIs take any subset; at least one). */
export function changedSettings<T extends object>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) if (after[key] !== before[key]) out[key] = after[key];
  return out;
}

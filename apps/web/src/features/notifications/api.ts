import { api } from '@/lib/api/client';

/**
 * How someone wants to hear from BUKU (GET/PUT /v1/users/me/notification-prefs).
 * Being called in a queue, and notices about the account's plan, are always sent.
 */
export interface NotificationPrefs {
  pushBookingConfirmation: boolean;
  pushReminders: boolean;
  pushQueueUpdates: boolean;
  pushBusinessAlerts: boolean;
  whatsappUpdates: boolean;
  smsReminders: boolean;
  emailBookingConfirmation: boolean;
  emailReminders: boolean;
  emailBusinessAlerts: boolean;
  /** Opt-in: "time for your usual…", openings at places they go. */
  suggestions: boolean;
  suggestionsConsentAt: string | null;
  marketingEmails: boolean;
  marketingConsentAt: string | null;
}

export type PrefsChange = Partial<
  Pick<
    NotificationPrefs,
    | 'emailBookingConfirmation'
    | 'emailReminders'
    | 'emailBusinessAlerts'
    | 'pushBookingConfirmation'
    | 'pushReminders'
    | 'pushQueueUpdates'
    | 'pushBusinessAlerts'
    | 'whatsappUpdates'
    | 'suggestions'
    | 'marketingEmails'
  >
>;

export const PREFS_KEY = ['notification-prefs'] as const;

export const fetchPrefs = () => api<NotificationPrefs>('users/me/notification-prefs');

export const updatePrefs = (change: PrefsChange) =>
  api<NotificationPrefs>('users/me/notification-prefs', { method: 'PUT', body: change });

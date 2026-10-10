import { api, apiCall } from '@/lib/api/client';

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

// ── The inbox ─────────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Where the message leads (`screen`) and what it's about. */
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface InboxPage {
  items: InboxItem[];
  meta: { page: number; limit: number; total: number; unread: number };
}

export const INBOX_KEY = ['inbox'] as const;
export const UNREAD_KEY = ['inbox', 'unread'] as const;

export async function fetchInbox(page: number, limit = 20): Promise<InboxPage> {
  const res = await apiCall<InboxItem[], InboxPage['meta']>('notifications', { query: { page, limit } });
  return { items: res.data, meta: res.meta ?? { page, limit, total: res.data.length, unread: 0 } };
}

export const fetchUnreadCount = () => api<{ unread: number }>('notifications/unread-count');
export const markRead = (id: string) => api<void>(`notifications/${id}/read`, { method: 'POST' });
export const markAllRead = () => api<void>('notifications/read-all', { method: 'POST' });
export const removeFromInbox = (id: string) => api<void>(`notifications/${id}`, { method: 'DELETE' });

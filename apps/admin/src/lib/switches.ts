/**
 * The emergency switches as the console shows them (D-129). The API lists them and says what each
 * stops; the console only names them.
 */
export interface SwitchView {
  key: string;
  /** What stops while it's off, in words (the API's). */
  what: string;
  off: boolean;
  reason: string | null;
  changedAt: string | null;
  changedBy: { id: string; name: string } | null;
}

const NAMES: Record<string, string> = {
  signups: 'Sign-ups',
  signin: 'Signing in',
  bookings: 'Bookings',
  queue: 'Walk-in queues',
  payments: 'Payments',
  uploads: 'Uploads',
  reviews: 'Reviews',
  business_signup: 'Registering businesses',
};

export const switchName = (key: string) => NAMES[key] ?? key;

/** The API's key format: lower case and underscores (it refuses any key it doesn't know). */
export const SWITCH_KEY = /^[a-z][a-z_]{0,31}$/;

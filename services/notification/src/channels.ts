import type { Category, Message } from './messages.js';

/**
 * Which channels a message goes out on, for one person (D-073). Pure: given
 * the message, how the person can be reached and the admin settings, it
 * decides. The inbox always gets it (that happens before this).
 *
 *  • PUSH      — free: every device they have, as their preferences allow.
 *  • EMAIL     — cheap: receipts and the day-before reminder always (if they
 *                want them); other messages only when they have no app to
 *                push to. Never for the live queue (too slow to be useful).
 *  • WHATSAPP  — for messages worth it, once they've connected their number:
 *                FREE whenever their 24-hour window is open (they messaged us
 *                recently); PAID (a template) only when they have no app, the
 *                admin allowed that message type, and the month's budget has room.
 */

export interface Prefs {
  pushBookingConfirmation: boolean;
  pushReminders: boolean;
  pushQueueUpdates: boolean;
  pushBusinessAlerts: boolean;
  whatsappUpdates: boolean;
  emailBookingConfirmation: boolean;
  emailReminders: boolean;
  emailBusinessAlerts: boolean;
}

export interface Reach {
  /** Has an active device that opened the app recently. */
  hasApp: boolean;
  /** Verified email address, or null. */
  email: string | null;
  /** Connected WhatsApp number (not opted out), and whether their free window is open. */
  whatsapp: { phone: string; windowOpen: boolean } | null;
  /** Null: never set, so the defaults (all on). */
  prefs: Prefs | null;
}

export interface ChannelSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappPaidTypes: readonly string[];
  /** A paid message still fits in this month's budget. */
  whatsappPaidAllowed: boolean;
  /** A message in the window is still free this month (else it costs like a paid one). */
  whatsappWindowFree: boolean;
}

export interface ChannelPlan {
  push: boolean;
  email: boolean;
  whatsapp: 'window' | 'template' | null;
}

type EmailRule = 'always' | 'no_app' | 'never';
type EmailPref = 'emailBookingConfirmation' | 'emailReminders' | 'emailBusinessAlerts' | null;

/** Per message type: when it may go by email (and which preference allows it), and whether WhatsApp is worth it. */
const RULES: Record<string, { email: EmailRule; emailPref: EmailPref; whatsapp: boolean }> = {
  booking_confirmed: { email: 'always', emailPref: 'emailBookingConfirmation', whatsapp: true },
  booking_requested: { email: 'no_app', emailPref: 'emailBookingConfirmation', whatsapp: false },
  booking_declined: { email: 'always', emailPref: 'emailBookingConfirmation', whatsapp: true },
  booking_cancelled_by_business: { email: 'always', emailPref: 'emailBookingConfirmation', whatsapp: true },
  booking_rescheduled: { email: 'always', emailPref: 'emailBookingConfirmation', whatsapp: true },
  booking_missed: { email: 'no_app', emailPref: 'emailBookingConfirmation', whatsapp: false },
  reminder_24h: { email: 'always', emailPref: 'emailReminders', whatsapp: true },
  reminder_2h: { email: 'no_app', emailPref: 'emailReminders', whatsapp: true },
  rebook_reminder: { email: 'no_app', emailPref: 'emailReminders', whatsapp: false },
  queue_position: { email: 'never', emailPref: null, whatsapp: false },
  queue_called: { email: 'never', emailPref: null, whatsapp: true },
  queue_closed: { email: 'never', emailPref: null, whatsapp: false },
  team_booking_request: { email: 'no_app', emailPref: 'emailBusinessAlerts', whatsapp: false },
  team_request_waiting: { email: 'no_app', emailPref: 'emailBusinessAlerts', whatsapp: false },
  team_new_booking: { email: 'no_app', emailPref: 'emailBusinessAlerts', whatsapp: false },
  team_booking_cancelled: { email: 'no_app', emailPref: 'emailBusinessAlerts', whatsapp: false },
  team_booking_moved: { email: 'no_app', emailPref: 'emailBusinessAlerts', whatsapp: false },
  // About their plan: always by email (no preference turns account notices off).
  trial_ending: { email: 'always', emailPref: null, whatsapp: false },
  trial_over: { email: 'always', emailPref: null, whatsapp: false },
  plan_gift_ending: { email: 'always', emailPref: null, whatsapp: false },
  plan_ending: { email: 'always', emailPref: null, whatsapp: false },
  payment_failed: { email: 'always', emailPref: null, whatsapp: false },
};
const UNKNOWN = { email: 'never', emailPref: null, whatsapp: false } as const;

const PUSH_PREF: Record<
  Exclude<Category, 'queue_called' | 'account'>,
  'pushBookingConfirmation' | 'pushReminders' | 'pushQueueUpdates' | 'pushBusinessAlerts'
> = {
  booking: 'pushBookingConfirmation',
  reminder: 'pushReminders',
  queue: 'pushQueueUpdates',
  business: 'pushBusinessAlerts',
};

export function pushAllowed(category: Category, prefs: Prefs | null): boolean {
  if (category === 'queue_called' || category === 'account') return true;
  return !prefs || prefs[PUSH_PREF[category]];
}

/** Which preference an email of this type is unsubscribed through (null: account notices). */
export function emailPrefOf(type: string): EmailPref {
  return (RULES[type] ?? UNKNOWN).emailPref;
}

export function planChannels(message: Message, reach: Reach, settings: ChannelSettings): ChannelPlan {
  const rule = RULES[message.type] ?? UNKNOWN;
  const push = reach.hasApp && pushAllowed(message.category, reach.prefs);

  const emailWanted = rule.email === 'always' || (rule.email === 'no_app' && !reach.hasApp);
  const email =
    settings.emailEnabled &&
    reach.email !== null &&
    emailWanted &&
    (rule.emailPref === null || !reach.prefs || reach.prefs[rule.emailPref]);

  let whatsapp: ChannelPlan['whatsapp'] = null;
  const wa = reach.whatsapp;
  if (settings.whatsappEnabled && wa && rule.whatsapp && (!reach.prefs || reach.prefs.whatsappUpdates)) {
    if (wa.windowOpen && (settings.whatsappWindowFree || (!reach.hasApp && settings.whatsappPaidAllowed))) {
      // Free while the month's allowance lasts; past it, a window message costs like a
      // paid one, so it's only sent to people the app can't reach.
      whatsapp = 'window';
    } else if (
      !wa.windowOpen &&
      !reach.hasApp &&
      message.vars?.length &&
      settings.whatsappPaidTypes.includes(message.type) &&
      settings.whatsappPaidAllowed
    ) {
      whatsapp = 'template';
    }
  }
  return { push, email, whatsapp };
}

/** "Night" in a timezone: reminders and suggestions wait for morning. start == end means never. */
export function isQuietHour(now: Date, timezone: string, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now),
  );
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

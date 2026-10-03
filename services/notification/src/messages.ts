/**
 * Every message BUKU sends, in one place (English first; D-039). Pure
 * functions: given what happened, they return the title, the text and the
 * deep link the app opens. Times are shown in the business's timezone.
 * Messages to businesses name the customer (first name and initial only);
 * messages to customers never name other customers.
 */

export type Category =
  'booking' | 'reminder' | 'queue' | 'queue_called' | 'business' | 'account' | 'suggestion';

export interface Message {
  type: string;
  /** Which preference allows the push (`queue_called` and `account` are never switched off). */
  category: Category;
  title: string;
  body: string;
  /** Deep link for the app. No secrets, no personal data. */
  data: Record<string, string | number>;
  /**
   * The values for this type's WhatsApp template, in the template's order (only
   * types that can go as a paid template have them; see whatsapp/templates.ts).
   */
  vars?: string[];
}

export interface Visit {
  appointmentId: string;
  businessId: string;
  businessName: string;
  serviceName: string;
  staffName: string | null;
  customerName: string;
  code: string;
  startAt: Date;
  timezone: string;
}

/** "Sat 4 Oct, 10:30" in the business's timezone. */
export function localTime(at: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}

/** "Ayesha K." — enough for the front desk, not a full name in every notification. */
export function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : (first ?? 'A customer');
}

/** "tomorrow" / "today" / "on Sat 4 Oct" relative to now, in the business's timezone. */
function dayWord(v: Visit, now = new Date()): string {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: v.timezone }).format(d);
  const target = day(v.startAt);
  if (target === day(now)) return 'today';
  if (target === day(new Date(now.getTime() + 86_400_000))) return 'tomorrow';
  return `on ${localTime(v.startAt, v.timezone).split(', ')[0]}`;
}

const visitLink = (v: Visit) => ({ screen: 'appointment', appointmentId: v.appointmentId });
const teamLink = (v: Visit) => ({
  screen: 'business-appointment',
  businessId: v.businessId,
  appointmentId: v.appointmentId,
});
const when = (v: Visit) => localTime(v.startAt, v.timezone);
/** Business, service, time, code: the order of the booking WhatsApp templates. */
const visitVars = (v: Visit) => [v.businessName, v.serviceName, when(v), v.code];
const withWhom = (v: Visit) => (v.staffName ? ` with ${v.staffName}` : '');

// ── To customers ───────────────────────────────────────────────────────────

export const toCustomer = {
  confirmed: (v: Visit): Message => ({
    type: 'booking_confirmed',
    category: 'booking',
    title: 'Booking confirmed',
    body: `${v.serviceName} at ${v.businessName}, ${when(v)}${withWhom(v)}. Your code: ${v.code}`,
    data: visitLink(v),
    vars: visitVars(v),
  }),
  requested: (v: Visit): Message => ({
    type: 'booking_requested',
    category: 'booking',
    title: 'Request sent',
    body: `${v.businessName} will confirm your ${v.serviceName} on ${when(v)}. We’ll let you know.`,
    data: visitLink(v),
  }),
  declined: (v: Visit, reason: string | null): Message => ({
    type: 'booking_declined',
    category: 'booking',
    title: 'Booking not accepted',
    body: `${v.businessName} couldn’t take your ${v.serviceName} on ${when(v)}${reason ? `: ${reason}` : ''}. Please choose another time.`,
    data: visitLink(v),
  }),
  cancelledByBusiness: (v: Visit, reason: string | null): Message => ({
    type: 'booking_cancelled_by_business',
    category: 'booking',
    title: 'Booking cancelled',
    body: `${v.businessName} cancelled your ${v.serviceName} on ${when(v)}${reason ? `: ${reason}` : ''}. Sorry for the trouble.`,
    data: visitLink(v),
    vars: [v.businessName, v.serviceName, when(v)],
  }),
  rescheduled: (v: Visit): Message => ({
    type: 'booking_rescheduled',
    category: 'booking',
    title: 'Booking moved',
    body: `Your ${v.serviceName} at ${v.businessName} is now ${when(v)}. Your new code: ${v.code}`,
    data: visitLink(v),
  }),
  missed: (v: Visit): Message => ({
    type: 'booking_missed',
    category: 'booking',
    title: 'We missed you',
    body: `Your ${v.serviceName} at ${v.businessName} on ${when(v)} was marked as missed. If you can’t make it next time, please cancel ahead.`,
    data: visitLink(v),
  }),
  reminder24h: (v: Visit): Message => ({
    type: 'reminder_24h',
    category: 'reminder',
    title: `Reminder: ${v.serviceName} ${dayWord(v)}`,
    body: `${v.serviceName} at ${v.businessName}, ${when(v)}${withWhom(v)}. Your code: ${v.code}. Can’t make it? Please cancel or move it in the app.`,
    data: visitLink(v),
    vars: visitVars(v),
  }),
  reminder2h: (v: Visit): Message => ({
    type: 'reminder_2h',
    category: 'reminder',
    title: `Soon: ${v.serviceName} at ${localTime(v.startAt, v.timezone).split(', ')[1]}`,
    body: `${v.businessName}${withWhom(v)}. Show code ${v.code} when you arrive.`,
    data: visitLink(v),
    vars: visitVars(v),
  }),
  /** After the visit: ask how it went (once; deep link to the review screen). */
  reviewRequest: (v: Visit): Message => ({
    type: 'review_request',
    category: 'reminder',
    title: `How was your ${v.serviceName}?`,
    body: `Tell others about ${v.businessName}${withWhom(v)} — it takes a few seconds and helps them choose.`,
    data: { screen: 'review', appointmentId: v.appointmentId },
  }),
  reviewReplied: (r: { appointmentId: string; businessName: string }): Message => ({
    type: 'review_replied',
    category: 'booking',
    title: `${r.businessName} replied to your review`,
    body: 'Tap to read their reply.',
    data: { screen: 'review', appointmentId: r.appointmentId },
  }),
  /** The customer asked "remind me to book again" (rebook_reminder_at). */
  bookAgain: (b: {
    businessId: string;
    businessName: string;
    serviceId: string;
    serviceName: string;
  }): Message => ({
    type: 'rebook_reminder',
    category: 'reminder',
    title: `Time to book ${b.serviceName} again?`,
    body: `You asked us to remind you. ${b.businessName} is taking bookings — pick a time that suits you.`,
    data: { screen: 'book', businessId: b.businessId, serviceId: b.serviceId },
  }),
  queueAhead: (entryId: string, businessName: string, ahead: number): Message => ({
    type: 'queue_position',
    category: 'queue',
    title: ahead === 0 ? 'You’re next' : `${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you`,
    body:
      ahead === 0
        ? `You’re next in line at ${businessName}. Please be ready.`
        : `At ${businessName}. ${ahead <= 5 ? 'Please start heading over.' : 'We’ll keep you posted.'}`,
    data: { screen: 'queue-ticket', entryId },
  }),
  queueCalled: (
    entryId: string,
    businessName: string,
    ticket: string,
    comeBy: Date | null,
    timezone: string,
  ): Message => ({
    type: 'queue_called',
    category: 'queue_called',
    title: `It’s your turn — ${ticket}`,
    body: `Please come to the counter at ${businessName}${comeBy ? ` by ${localTime(comeBy, timezone).split(', ')[1]}` : ''}.`,
    data: { screen: 'queue-ticket', entryId },
    vars: [ticket, businessName],
  }),
  queueClosed: (entryId: string, businessName: string, ticket: string): Message => ({
    type: 'queue_closed',
    category: 'queue',
    title: 'The queue has closed',
    body: `${businessName} closed its queue for today before ticket ${ticket} was called. Sorry — please try again another day.`,
    data: { screen: 'queue-ticket', entryId },
  }),
};

// ── To the business's team ─────────────────────────────────────────────────

export const toTeam = {
  request: (v: Visit): Message => ({
    type: 'team_booking_request',
    category: 'business',
    title: 'New booking request',
    body: `${shortName(v.customerName)} asks for ${v.serviceName} on ${when(v)}${withWhom(v)}. Confirm or decline.`,
    data: teamLink(v),
  }),
  booked: (v: Visit): Message => ({
    type: 'team_new_booking',
    category: 'business',
    title: 'New booking',
    body: `${shortName(v.customerName)} booked ${v.serviceName} on ${when(v)}${withWhom(v)}.`,
    data: teamLink(v),
  }),
  cancelled: (v: Visit, late: boolean): Message => ({
    type: 'team_booking_cancelled',
    category: 'business',
    title: late ? 'Late cancellation' : 'Booking cancelled',
    body: `${shortName(v.customerName)} cancelled ${v.serviceName} on ${when(v)}${withWhom(v)}. The time is free again.`,
    data: teamLink(v),
  }),
  newReview: (r: {
    businessId: string;
    reviewId: string;
    reviewer: string;
    overall: number;
    serviceName: string;
  }): Message => ({
    type: 'team_new_review',
    category: 'business',
    title: `New ${r.overall}★ review`,
    body: `${r.reviewer} reviewed ${r.serviceName}. Reply to show customers you listen.`,
    data: { screen: 'business-review', businessId: r.businessId, reviewId: r.reviewId },
  }),
  /** A request nobody has answered yet, as its time gets close. */
  stillPending: (v: Visit): Message => ({
    type: 'team_request_waiting',
    category: 'business',
    title: 'A booking request is waiting',
    body: `${shortName(v.customerName)} is still waiting to hear about ${v.serviceName} on ${when(v)}${withWhom(v)}. Please confirm or decline.`,
    data: teamLink(v),
  }),
  moved: (v: Visit): Message => ({
    type: 'team_booking_moved',
    category: 'business',
    title: 'Booking moved',
    body: `${shortName(v.customerName)} moved ${v.serviceName} to ${when(v)}${withWhom(v)}.`,
    data: teamLink(v),
  }),
};

// ── Suggestions, from how each person uses BUKU (opt-in; D-075) ───────────

/** A free time to show in a suggestion ("Thu at 10:30 with Ali"). */
export interface Opening {
  startAt: Date;
  staffId: string | null;
  staffName: string | null;
}

export interface UsualVisit {
  businessId: string;
  businessName: string;
  serviceId: string;
  serviceName: string;
  timezone: string;
  /** Typical days between their visits. */
  everyDays: number;
  /** Days since the last one. */
  sinceDays: number;
  opening: Opening | null;
}

/** "about 2 weeks", "about a month", "about 3 months". */
export function roughly(days: number): string {
  if (days < 11) return `about ${Math.max(1, Math.round(days))} days`;
  if (days < 28) return `about ${Math.round(days / 7)} weeks`;
  if (days < 45) return 'about a month';
  return `about ${Math.round(days / 30)} months`;
}

const openingText = (o: Opening, timezone: string) => {
  const [day, time] = localTime(o.startAt, timezone).split(', ');
  return `${o.staffName ? `${o.staffName} has` : 'There’s'} an opening on ${day} at ${time}`;
};

export const suggest = {
  /** A regular whose usual visit is coming due, with a real free time if there is one. */
  usual: (u: UsualVisit): Message => ({
    type: 'suggest_usual',
    category: 'suggestion',
    title: `Time for your usual ${u.serviceName}?`,
    body: `It’s been ${roughly(u.sinceDays)} since your last visit to ${u.businessName}. ${
      u.opening ? `${openingText(u.opening, u.timezone)} — book it in a tap.` : 'Book your next one in a tap.'
    }`,
    data: {
      screen: 'book',
      businessId: u.businessId,
      serviceId: u.serviceId,
      ...(u.opening?.staffId && { staffId: u.opening.staffId }),
      ...(u.opening && { startAt: u.opening.startAt.toISOString() }),
    },
  }),
  /** Someone who stopped coming: their most-visited place is taking bookings. */
  comeBack: (b: {
    businessId: string;
    businessName: string;
    serviceId: string | null;
    serviceName: string | null;
  }): Message => ({
    type: 'suggest_comeback',
    category: 'suggestion',
    title: `${b.businessName} is taking bookings`,
    body: `It’s been a while! ${
      b.serviceName ? `Book your ${b.serviceName} again` : 'Book again'
    } in a tap — or find something new nearby on BUKU.`,
    data: b.serviceId
      ? { screen: 'book', businessId: b.businessId, serviceId: b.serviceId }
      : { screen: 'business', businessId: b.businessId },
  }),
  /** A new account that hasn't booked anything yet (step 1 or 2). */
  firstBooking: (step: 1 | 2): Message =>
    step === 1
      ? {
          type: 'suggest_first_booking',
          category: 'suggestion',
          title: 'Book your first visit',
          body: 'Barbers, clinics, salons and more near you — see real free times and book in seconds. No calls, no waiting on hold.',
          data: { screen: 'explore' },
        }
      : {
          type: 'suggest_first_booking',
          category: 'suggestion',
          title: 'Skip the waiting room',
          body: 'Join a queue from your phone and come when it’s nearly your turn, or book a time that suits you.',
          data: { screen: 'explore' },
        },
};

// ── About the account's plan (users and business owners) ──────────────────

export interface PlanNotice {
  /** Business plans: the business's name ("for Fade Studio"); null for the person's own plan. */
  businessId: string | null;
  businessName: string | null;
  planName: string;
  endsAt: Date;
  timezone: string;
}

const billingLink = (businessId: string | null): Message['data'] =>
  businessId ? { screen: 'business-billing', businessId } : { screen: 'billing' };
const planLink = (p: PlanNotice) => billingLink(p.businessId);
const forWhom = (p: PlanNotice) => (p.businessName ? ` for ${p.businessName}` : '');
const day = (p: PlanNotice) => localTime(p.endsAt, p.timezone).split(', ')[0]!;

export const toAccount = {
  trialEnding: (p: PlanNotice): Message => ({
    type: 'trial_ending',
    category: 'account',
    title: 'Your free trial ends soon',
    body: `Your ${p.planName} trial${forWhom(p)} ends on ${day(p)}. Choose a plan to keep its benefits — nothing is charged unless you do.`,
    data: planLink(p),
  }),
  trialOver: (p: PlanNotice): Message => ({
    type: 'trial_over',
    category: 'account',
    title: 'Your free trial has ended',
    body: `Your ${p.planName} trial${forWhom(p)} has ended. Your bookings and data are safe; choose a plan any time to get its benefits back.`,
    data: planLink(p),
  }),
  grantEnding: (p: PlanNotice): Message => ({
    type: 'plan_gift_ending',
    category: 'account',
    title: `Your ${p.planName} plan ends soon`,
    body: `The ${p.planName} plan we gave you${forWhom(p)} ends on ${day(p)}. Choose a plan to keep its benefits.`,
    data: planLink(p),
  }),
  planEnding: (p: PlanNotice): Message => ({
    type: 'plan_ending',
    category: 'account',
    title: `Your ${p.planName} plan ends soon`,
    body: `You cancelled ${p.planName}${forWhom(p)}; it stays active until ${day(p)}. Changed your mind? You can keep it from the billing page.`,
    data: planLink(p),
  }),
  paymentFailed: (p: Omit<PlanNotice, 'endsAt'>): Message => ({
    type: 'payment_failed',
    category: 'account',
    title: 'Payment didn’t go through',
    body: `We couldn’t take the payment for ${p.planName}${p.businessName ? ` for ${p.businessName}` : ''}. Please update your card so it stays active.`,
    data: billingLink(p.businessId),
  }),
};

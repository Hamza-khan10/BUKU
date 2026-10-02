/**
 * Every message BUKU sends, in one place (English first; D-039). Pure
 * functions: given what happened, they return the title, the text and the
 * deep link the app opens. Times are shown in the business's timezone.
 * Messages to businesses name the customer (first name and initial only);
 * messages to customers never name other customers.
 */

export type Category = 'booking' | 'reminder' | 'queue' | 'queue_called' | 'business';

export interface Message {
  type: string;
  /** Which preference allows the push (`queue_called` is never switched off). */
  category: Category;
  title: string;
  body: string;
  /** Deep link for the app. No secrets, no personal data. */
  data: Record<string, string | number>;
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

const visitLink = (v: Visit) => ({ screen: 'appointment', appointmentId: v.appointmentId });
const teamLink = (v: Visit) => ({
  screen: 'business-appointment',
  businessId: v.businessId,
  appointmentId: v.appointmentId,
});
const when = (v: Visit) => localTime(v.startAt, v.timezone);
const withWhom = (v: Visit) => (v.staffName ? ` with ${v.staffName}` : '');

// ── To customers ───────────────────────────────────────────────────────────

export const toCustomer = {
  confirmed: (v: Visit): Message => ({
    type: 'booking_confirmed',
    category: 'booking',
    title: 'Booking confirmed',
    body: `${v.serviceName} at ${v.businessName}, ${when(v)}${withWhom(v)}. Your code: ${v.code}`,
    data: visitLink(v),
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
  moved: (v: Visit): Message => ({
    type: 'team_booking_moved',
    category: 'business',
    title: 'Booking moved',
    body: `${shortName(v.customerName)} moved ${v.serviceName} to ${when(v)}${withWhom(v)}.`,
    data: teamLink(v),
  }),
};

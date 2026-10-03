import { describe, expect, it } from 'vitest';
import { planChannels, type ChannelSettings, type Reach } from '../src/channels.js';
import { roughly, suggest } from '../src/messages.js';
import { pickOpening, type Slot } from '../src/scheduler/openings.js';
import {
  capsAllow,
  everyDays,
  firstBookingStep,
  usualDue,
  usualMinuteOfDay,
} from '../src/scheduler/suggestion-rules.js';

const DAY = 86_400_000;
const d = (iso: string) => new Date(iso);
const daysAfter = (base: Date, n: number) => new Date(base.getTime() + n * DAY);

describe('Regulars: their rhythm', () => {
  it('the typical gap is the median, so one odd visit doesn’t change it', () => {
    const base = d('2026-01-01T06:00:00Z');
    expect(everyDays([0, 28, 56].map((n) => daysAfter(base, n)))).toBe(28);
    expect(everyDays([0, 7, 14, 60, 67].map((n) => daysAfter(base, n)))).toBe(7);
  });

  it('no rhythm: fewer than 3 visits, a gap under 5 days, or over 4 months', () => {
    const base = d('2026-01-01T06:00:00Z');
    expect(everyDays([0, 28].map((n) => daysAfter(base, n)))).toBeNull();
    expect(everyDays([0, 2, 4].map((n) => daysAfter(base, n)))).toBeNull();
    expect(everyDays([0, 130, 260].map((n) => daysAfter(base, n)))).toBeNull();
  });

  it('due from 85% of their gap until twice it; then they are “overdue” (the come-back message)', () => {
    const last = d('2026-03-01T06:00:00Z');
    expect(usualDue(last, 28, daysAfter(last, 23))).toBe('not_yet');
    expect(usualDue(last, 28, daysAfter(last, 24))).toBe('due');
    expect(usualDue(last, 28, daysAfter(last, 56))).toBe('due');
    expect(usualDue(last, 28, daysAfter(last, 57))).toBe('overdue');
  });

  it('their usual time of day, in the business’s timezone', () => {
    const visits = ['2026-01-03T05:30:00Z', '2026-01-31T06:00:00Z', '2026-02-28T05:00:00Z'].map(d);
    expect(usualMinuteOfDay(visits, 'Asia/Karachi')).toBe(10 * 60 + 30);
    expect(usualMinuteOfDay([], 'UTC')).toBeNull();
  });
});

describe('Choosing the opening to show', () => {
  const slot = (iso: string, time: string, staffIds = ['s1']): Slot => ({ startAt: d(iso), time, staffIds });
  it('earliest day, closest to their usual time', () => {
    const slots = [
      slot('2026-03-05T04:00:00Z', '09:00'),
      slot('2026-03-05T06:00:00Z', '11:00'),
      slot('2026-03-05T11:00:00Z', '16:00'),
      slot('2026-03-06T05:30:00Z', '10:30'),
    ];
    expect(pickOpening(slots, 10 * 60 + 30, 'Asia/Karachi')!.time).toBe('11:00');
    expect(pickOpening(slots, null, 'Asia/Karachi')!.time).toBe('09:00');
    expect(pickOpening([], 600, 'UTC')).toBeNull();
  });
});

describe('Caps', () => {
  const s = { suggestionMinDays: 7, suggestionMaxPer30Days: 3, suggestionMaxIgnored: 3 };
  const now = d('2026-06-01T10:00:00Z');
  const ok = { lastSentAt: null, sentLast30Days: 0, sentSinceLastBooking: 0 };
  it('a gap between suggestions, a monthly maximum, and stop when ignored', () => {
    expect(capsAllow(ok, s, now)).toBe(true);
    expect(capsAllow({ ...ok, lastSentAt: daysAfter(now, -6) }, s, now)).toBe(false);
    expect(capsAllow({ ...ok, lastSentAt: daysAfter(now, -7) }, s, now)).toBe(true);
    expect(capsAllow({ ...ok, sentLast30Days: 3 }, s, now)).toBe(false);
    expect(capsAllow({ ...ok, sentSinceLastBooking: 3 }, s, now)).toBe(false);
    expect(capsAllow(ok, { ...s, suggestionMaxPer30Days: 0 }, now)).toBe(false);
  });
});

describe('New accounts that never booked', () => {
  const created = d('2026-06-01T10:00:00Z');
  it('day 2, then day 10 (at least a week after the first), never after day 30', () => {
    expect(firstBookingStep(created, daysAfter(created, 1), null, false)).toBeNull();
    expect(firstBookingStep(created, daysAfter(created, 2), null, false)).toBe(1);
    expect(firstBookingStep(created, daysAfter(created, 9), daysAfter(created, 2), false)).toBeNull();
    expect(firstBookingStep(created, daysAfter(created, 10), daysAfter(created, 2), false)).toBe(2);
    // first one went late (day 8): the second waits a week after it
    expect(firstBookingStep(created, daysAfter(created, 12), daysAfter(created, 8), false)).toBeNull();
    expect(firstBookingStep(created, daysAfter(created, 15), daysAfter(created, 8), false)).toBe(2);
    expect(firstBookingStep(created, daysAfter(created, 20), daysAfter(created, 2), true)).toBeNull();
    expect(firstBookingStep(created, daysAfter(created, 31), null, false)).toBeNull();
  });
});

describe('Suggestion messages and channels', () => {
  const usual = suggest.usual({
    businessId: 'b',
    businessName: 'Fade Studio',
    serviceId: 's',
    serviceName: 'Haircut',
    timezone: 'Asia/Karachi',
    everyDays: 28,
    sinceDays: 26,
    opening: { startAt: d('2026-03-05T05:30:00Z'), staffId: 'st', staffName: 'Ali' },
  });

  it('say how long it has been and offer a real time', () => {
    expect(usual.title).toBe('Time for your usual Haircut?');
    expect(usual.body).toBe(
      'It’s been about 4 weeks since your last visit to Fade Studio. Ali has an opening on Thu 5 Mar at 10:30 — book it in a tap.',
    );
    expect(usual.data).toEqual({
      screen: 'book',
      businessId: 'b',
      serviceId: 's',
      staffId: 'st',
      startAt: '2026-03-05T05:30:00.000Z',
    });
    expect([roughly(3), roughly(14), roughly(30), roughly(95)]).toEqual([
      'about 3 days',
      'about 2 weeks',
      'about a month',
      'about 3 months',
    ]);
  });

  const on: ChannelSettings = {
    emailEnabled: true,
    whatsappEnabled: true,
    whatsappPaidTypes: ['suggest_usual'],
    whatsappPaidAllowed: true,
    whatsappWindowFree: true,
  };
  const base = {
    pushBookingConfirmation: true,
    pushReminders: true,
    pushQueueUpdates: true,
    pushBusinessAlerts: true,
    whatsappUpdates: true,
    emailBookingConfirmation: true,
    emailReminders: true,
    emailBusinessAlerts: true,
    suggestions: false,
    marketingEmails: false,
  };
  const reach = (over: Partial<Reach>): Reach => ({
    hasApp: true,
    email: 'a@example.test',
    whatsapp: null,
    prefs: base,
    ...over,
  });

  it('opt-in only: nothing without consent (or with default settings)', () => {
    expect(planChannels(usual, reach({}), on)).toEqual({ push: false, email: false, whatsapp: null });
    expect(planChannels(usual, reach({ prefs: null, hasApp: false }), on)).toEqual({
      push: false,
      email: false,
      whatsapp: null,
    });
  });

  it('opted in: push; email only for people without the app and with marketing consent', () => {
    expect(planChannels(usual, reach({ prefs: { ...base, suggestions: true } }), on).push).toBe(true);
    expect(
      planChannels(usual, reach({ prefs: { ...base, marketingEmails: true }, hasApp: false }), on).email,
    ).toBe(true);
    expect(planChannels(usual, reach({ prefs: { ...base, marketingEmails: true } }), on).email).toBe(false);
  });

  it('WhatsApp only while free — never a paid message, even if an admin listed it', () => {
    const p = { ...base, suggestions: true };
    expect(
      planChannels(usual, reach({ prefs: p, whatsapp: { phone: '+92300', windowOpen: true } }), on).whatsapp,
    ).toBe('window');
    expect(
      planChannels(
        usual,
        reach({ prefs: p, hasApp: false, whatsapp: { phone: '+92300', windowOpen: false } }),
        on,
      ).whatsapp,
    ).toBeNull();
    expect(
      planChannels(
        usual,
        reach({ prefs: p, hasApp: false, whatsapp: { phone: '+92300', windowOpen: true } }),
        { ...on, whatsappWindowFree: false },
      ).whatsapp,
    ).toBeNull();
  });
});

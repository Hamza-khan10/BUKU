import { describe, expect, it } from 'vitest';
import { isQuietHour, planChannels, type ChannelSettings, type Prefs, type Reach } from '../src/channels.js';
import { toAccount, toCustomer, toTeam, type Visit } from '../src/messages.js';

const visit: Visit = {
  appointmentId: '0190a1b2-0000-7000-8000-000000000001',
  businessId: '0190a1b2-0000-7000-8000-000000000002',
  businessName: 'Fade Studio',
  serviceName: 'Haircut',
  staffName: 'Ali',
  customerName: 'Ayesha Khan',
  code: 'BK-7Q4M2X',
  startAt: new Date('2026-10-10T05:30:00Z'),
  timezone: 'Asia/Karachi',
};

const prefs = (over: Partial<Prefs> = {}): Prefs => ({
  pushBookingConfirmation: true,
  pushReminders: true,
  pushQueueUpdates: true,
  pushBusinessAlerts: true,
  whatsappUpdates: true,
  emailBookingConfirmation: true,
  emailReminders: true,
  emailBusinessAlerts: true,
  ...over,
});
const reach = (over: Partial<Reach> = {}): Reach => ({
  hasApp: true,
  email: 'a@example.test',
  whatsapp: null,
  prefs: null,
  ...over,
});
const on: ChannelSettings = {
  emailEnabled: true,
  whatsappEnabled: true,
  whatsappPaidTypes: ['reminder_24h', 'reminder_2h', 'booking_confirmed', 'queue_called'],
  whatsappPaidAllowed: true,
  whatsappWindowFree: true,
};
const wa = (windowOpen: boolean) => ({ phone: '+923001234567', windowOpen });

describe('Which channels a message goes on', () => {
  it('app users: push; receipts and day-before reminders also by email; queue never by email', () => {
    expect(planChannels(toCustomer.confirmed(visit), reach(), on)).toEqual({
      push: true,
      email: true,
      whatsapp: null,
    });
    expect(planChannels(toCustomer.reminder24h(visit), reach(), on)).toMatchObject({ email: true });
    expect(planChannels(toCustomer.reminder2h(visit), reach(), on)).toMatchObject({
      push: true,
      email: false,
    });
    expect(
      planChannels(toCustomer.queueCalled('e', 'Fade', 'A-001', null, 'UTC'), reach({ hasApp: false }), on),
    ).toMatchObject({ email: false });
  });

  it('people without the app: email fills in for what push would have said', () => {
    const noApp = reach({ hasApp: false });
    expect(planChannels(toCustomer.reminder2h(visit), noApp, on)).toEqual({
      push: false,
      email: true,
      whatsapp: null,
    });
    expect(planChannels(toTeam.booked(visit), noApp, on).email).toBe(true);
    expect(planChannels(toTeam.booked(visit), reach(), on).email).toBe(false);
  });

  it('email needs a verified address, the matching preference, and email switched on', () => {
    expect(planChannels(toCustomer.confirmed(visit), reach({ email: null }), on).email).toBe(false);
    expect(
      planChannels(
        toCustomer.confirmed(visit),
        reach({ prefs: prefs({ emailBookingConfirmation: false }) }),
        on,
      ).email,
    ).toBe(false);
    expect(
      planChannels(toCustomer.reminder24h(visit), reach({ prefs: prefs({ emailReminders: false }) }), on)
        .email,
    ).toBe(false);
    expect(planChannels(toCustomer.confirmed(visit), reach(), { ...on, emailEnabled: false }).email).toBe(
      false,
    );
  });

  it('plan notices always go by email and push, whatever the preferences', () => {
    const notice = toAccount.trialEnding({
      businessId: null,
      businessName: null,
      planName: 'BUKU Plus',
      endsAt: new Date(),
      timezone: 'UTC',
    });
    const allOff = prefs({
      pushBookingConfirmation: false,
      pushReminders: false,
      emailBookingConfirmation: false,
      emailReminders: false,
    });
    expect(planChannels(notice, reach({ prefs: allOff }), on)).toEqual({
      push: true,
      email: true,
      whatsapp: null,
    });
  });

  it('push follows the category preference; being called in the queue always pushes', () => {
    const off = prefs({ pushBookingConfirmation: false, pushQueueUpdates: false });
    expect(planChannels(toCustomer.confirmed(visit), reach({ prefs: off }), on).push).toBe(false);
    expect(
      planChannels(toCustomer.queueCalled('e', 'Fade', 'A-001', null, 'UTC'), reach({ prefs: off }), on).push,
    ).toBe(true);
  });

  describe('WhatsApp', () => {
    it('free window open → sent free, even to app users', () => {
      expect(planChannels(toCustomer.reminder24h(visit), reach({ whatsapp: wa(true) }), on).whatsapp).toBe(
        'window',
      );
    });

    it('window closed → a paid template only for people without the app, allowed types, budget left', () => {
      const closed = reach({ hasApp: false, whatsapp: wa(false) });
      expect(planChannels(toCustomer.reminder24h(visit), closed, on).whatsapp).toBe('template');
      // has the app: push is free, don't pay
      expect(
        planChannels(toCustomer.reminder24h(visit), reach({ whatsapp: wa(false) }), on).whatsapp,
      ).toBeNull();
      // type not allowed as paid
      expect(
        planChannels(toCustomer.reminder24h(visit), closed, { ...on, whatsappPaidTypes: [] }).whatsapp,
      ).toBeNull();
      // budget spent
      expect(
        planChannels(toCustomer.reminder24h(visit), closed, { ...on, whatsappPaidAllowed: false }).whatsapp,
      ).toBeNull();
      // no template exists for it (no vars)
      expect(
        planChannels(toCustomer.declined(visit, null), closed, {
          ...on,
          whatsappPaidTypes: ['booking_declined'],
        }).whatsapp,
      ).toBeNull();
    });

    it('free allowance used up → window messages only to people without the app, within budget', () => {
      const past = { ...on, whatsappWindowFree: false };
      expect(
        planChannels(toCustomer.reminder24h(visit), reach({ whatsapp: wa(true) }), past).whatsapp,
      ).toBeNull();
      expect(
        planChannels(toCustomer.reminder24h(visit), reach({ hasApp: false, whatsapp: wa(true) }), past)
          .whatsapp,
      ).toBe('window');
      expect(
        planChannels(toCustomer.reminder24h(visit), reach({ hasApp: false, whatsapp: wa(true) }), {
          ...past,
          whatsappPaidAllowed: false,
        }).whatsapp,
      ).toBeNull();
    });

    it('never: WhatsApp off, their WhatsApp preference off, not worth it (queue position), or not connected', () => {
      const r = reach({ whatsapp: wa(true) });
      expect(
        planChannels(toCustomer.reminder24h(visit), r, { ...on, whatsappEnabled: false }).whatsapp,
      ).toBeNull();
      expect(
        planChannels(toCustomer.reminder24h(visit), { ...r, prefs: prefs({ whatsappUpdates: false }) }, on)
          .whatsapp,
      ).toBeNull();
      expect(planChannels(toCustomer.queueAhead('e', 'Fade', 3), r, on).whatsapp).toBeNull();
      expect(planChannels(toCustomer.reminder24h(visit), reach(), on).whatsapp).toBeNull();
    });
  });
});

describe('Quiet hours', () => {
  it('handles nights that cross midnight, daytime ranges, and "off"', () => {
    // 21:00–09:00 in Karachi (UTC+5)
    expect(isQuietHour(new Date('2026-10-10T16:30:00Z'), 'Asia/Karachi', 21, 9)).toBe(true); // 21:30
    expect(isQuietHour(new Date('2026-10-10T03:59:00Z'), 'Asia/Karachi', 21, 9)).toBe(true); // 08:59
    expect(isQuietHour(new Date('2026-10-10T04:00:00Z'), 'Asia/Karachi', 21, 9)).toBe(false); // 09:00
    expect(isQuietHour(new Date('2026-10-10T15:59:00Z'), 'Asia/Karachi', 21, 9)).toBe(false); // 20:59
    expect(isQuietHour(new Date('2026-10-10T13:00:00Z'), 'UTC', 12, 14)).toBe(true);
    expect(isQuietHour(new Date('2026-10-10T03:00:00Z'), 'UTC', 9, 9)).toBe(false);
  });
});

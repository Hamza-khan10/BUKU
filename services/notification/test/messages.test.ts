import { describe, expect, it } from 'vitest';
import { localTime, shortName, toCustomer, toTeam, type Visit } from '../src/messages.js';

const visit: Visit = {
  appointmentId: 'a1',
  businessId: 'b1',
  businessName: 'Fade Masters',
  serviceName: 'Skin fade',
  staffName: 'Ali',
  customerName: 'Ayesha Noor Khan',
  code: 'BK-7KQ2MX',
  startAt: new Date('2026-10-04T05:30:00Z'), // 10:30 in Lahore
  timezone: 'Asia/Karachi',
};

describe('messages', () => {
  it('shows times in the business’s timezone', () => {
    expect(localTime(visit.startAt, 'Asia/Karachi')).toBe('Sun 4 Oct, 10:30');
    expect(localTime(visit.startAt, 'Europe/London')).toBe('Sun 4 Oct, 06:30');
  });

  it('customers get the receipt code; businesses get the customer’s first name and initial', () => {
    expect(toCustomer.confirmed(visit)).toMatchObject({
      title: 'Booking confirmed',
      body: 'Skin fade at Fade Masters, Sun 4 Oct, 10:30 with Ali. Your code: BK-7KQ2MX',
      data: { screen: 'appointment', appointmentId: 'a1' },
    });
    expect(toTeam.request(visit).body).toBe(
      'Ayesha K. asks for Skin fade on Sun 4 Oct, 10:30 with Ali. Confirm or decline.',
    );
    expect(shortName('Bilal')).toBe('Bilal');
  });

  it('queue alerts count down and the call can’t be muted', () => {
    expect(toCustomer.queueAhead('e1', 'NADRA', 10).title).toBe('10 people ahead of you');
    expect(toCustomer.queueAhead('e1', 'NADRA', 1).title).toBe('1 person ahead of you');
    expect(toCustomer.queueAhead('e1', 'NADRA', 0).title).toBe('You’re next');
    const called = toCustomer.queueCalled(
      'e1',
      'NADRA',
      'A-023',
      new Date('2026-10-04T09:05:00Z'),
      'Asia/Karachi',
    );
    expect([called.title, called.body, called.category]).toEqual([
      'It’s your turn — A-023',
      'Please come to the counter at NADRA by 14:05.',
      'queue_called',
    ]);
  });

  it('reasons are included when given', () => {
    expect(toCustomer.declined(visit, 'Fully booked').body).toContain(': Fully booked.');
    expect(toCustomer.cancelledByBusiness(visit, null).body).not.toContain(': ');
    expect(toTeam.cancelled(visit, true).title).toBe('Late cancellation');
  });
});

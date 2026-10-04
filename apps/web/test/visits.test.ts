import { describe, expect, it } from 'vitest';
import { foldLine, icsFileName, icsFor, icsMoment, icsText } from '../src/features/booking/calendar';
import { windowFor } from '../src/features/booking/choices';
import { visitBadge } from '../src/features/booking/components/visit-list';
import type { Receipt } from '../src/features/booking/types';

const receipt: Receipt = {
  id: '0190a0b2-7c4e-7a3e-9f00-0000000000aa',
  code: 'BK-7KQ2MX',
  qr: 'BK-7KQ2MX',
  status: 'confirmed',
  business: {
    id: 'b1',
    slug: 'fade-masters-lahore',
    name: 'Fade Masters',
    address: { line: '92 Main Boulevard, Block A', city: 'Lahore' },
    phone: null,
  },
  service: { id: 's1', name: 'Haircut', durationMinutes: 30 },
  staff: { id: 'p1', displayName: 'Maryam Sheikh' },
  startAt: '2026-10-06T05:00:00.000Z',
  endAt: '2026-10-06T05:30:00.000Z',
  local: { date: '2026-10-06', startTime: '10:00', endTime: '10:30', timezone: 'Asia/Karachi' },
  price: '800.00',
  currency: 'PKR',
  payment: 'pay_at_venue',
  notes: null,
  policy: { canCancel: true, freeCancellationUntil: '2026-10-05T17:00:00.000Z', canReschedule: true },
  checkedInAt: null,
  cancellation: null,
  rescheduledFromId: null,
  createdAt: '2026-10-05T10:00:00.000Z',
};

describe('add to calendar (RFC 5545)', () => {
  const url = 'https://buku.example/appointments/x';
  const ics = icsFor(receipt, url, new Date('2026-10-05T10:00:00Z'));

  it('is one event at the visit’s exact time, with CRLF line ends', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics).toContain('DTSTART:20261006T050000Z\r\n');
    expect(ics).toContain('DTEND:20261006T053000Z\r\n');
    expect(ics).toContain(`UID:${receipt.id}@buku\r\n`);
    expect(ics).toContain('STATUS:CONFIRMED\r\n');
    expect(ics).not.toMatch(/[^\r]\n/); // no bare line feeds
  });

  it('says what, where and the code, escaped the way calendars need', () => {
    expect(ics).toContain('SUMMARY:Haircut at Fade Masters\r\n');
    expect(ics).toContain('LOCATION:92 Main Boulevard\\, Block A\\, Lahore\r\n');
    expect(ics.replace(/\r\n /g, '')).toContain('Booking code BK-7KQ2MX');
    expect(icsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });

  it('a request not yet confirmed is tentative', () => {
    expect(icsFor({ ...receipt, status: 'pending' }, url, new Date())).toContain('STATUS:TENTATIVE');
  });

  it('folds long lines at 75 bytes, without splitting a character', () => {
    const long = `DESCRIPTION:${'ﷺ'.repeat(40)}`;
    const folded = foldLine(long);
    for (const part of folded.split('\r\n'))
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
  });

  it('names the file after the place and the day', () => {
    expect(icsFileName(receipt)).toBe('buku-fade-masters-lahore-2026-10-06.ics');
    expect(icsMoment('2026-10-06T05:00:00.000Z')).toBe('20261006T050000Z');
  });
});

describe('the two-week day window', () => {
  it('starts today, or at the window holding the chosen day', () => {
    expect(windowFor('2026-10-05', null)).toBe('2026-10-05');
    expect(windowFor('2026-10-05', '2026-10-18')).toBe('2026-10-05');
    expect(windowFor('2026-10-05', '2026-10-19')).toBe('2026-10-19');
    expect(windowFor('2026-10-05', '2026-10-01')).toBe('2026-10-05');
  });
});

describe('visit labels in the list', () => {
  it('say where each visit stands, and who cancelled', () => {
    expect(visitBadge(receipt, false)).toEqual({ label: 'Confirmed', tone: 'ok' });
    expect(visitBadge(receipt, true)).toEqual({ label: 'Booked', tone: 'neutral' });
    expect(visitBadge({ ...receipt, status: 'pending' }, false).label).toBe('Waiting to be confirmed');
    const cancelled = (by: string, reasonCode: string | null) => ({
      ...receipt,
      status: 'cancelled' as const,
      cancellation: { cancelledAt: null, cancelledBy: by, reasonCode, reason: null },
    });
    expect(visitBadge(cancelled('user', 'illness'), true).label).toBe('Cancelled');
    expect(visitBadge(cancelled('business', 'declined'), true).label).toBe('Declined');
    expect(visitBadge(cancelled('business', null), true).label).toBe('Cancelled by the business');
    expect(visitBadge({ ...receipt, status: 'no_show' }, true)).toEqual({ label: 'Missed', tone: 'danger' });
  });
});

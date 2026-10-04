import { describe, expect, it } from 'vitest';
import { linkFor } from '../src/features/notifications/links';
import { ago } from '../src/features/notifications/time';

const A = '0190a0b2-7c4e-7a3e-9f00-0000000000aa';
const B = '0190a0b2-7c4e-7a3e-9f00-0000000000bb';
const S = '0190a0b2-7c4e-7a3e-9f00-0000000000cc';

describe('where a message leads', () => {
  it('opens the page it is about', () => {
    expect(linkFor({ screen: 'appointment', appointmentId: A })).toBe(`/appointments/${A}`);
    expect(linkFor({ screen: 'review', appointmentId: A })).toBe(`/appointments/${A}/review`);
    expect(linkFor({ screen: 'queue-ticket', entryId: A })).toBe(`/queue/${A}`);
    expect(linkFor({ screen: 'business', businessId: B })).toBe(`/b/${B}`);
    expect(linkFor({ screen: 'explore' })).toBe('/explore');
  });

  it('a suggestion opens booking with its choices filled in', () => {
    expect(linkFor({ screen: 'book', businessId: B, serviceId: S })).toBe(`/b/${B}/book?service=${S}`);
    expect(
      linkFor({
        screen: 'book',
        businessId: B,
        serviceId: S,
        staffId: A,
        startAt: '2026-10-06T05:00:00.000Z',
      }),
    ).toBe(`/b/${B}/book?service=${S}&staff=${A}&time=2026-10-06T05%3A00%3A00.000Z`);
  });

  it('has no link for screens this site doesn’t have, or for anything malformed', () => {
    for (const data of [
      { screen: 'billing' },
      { screen: 'business-appointment', appointmentId: A },
      { screen: 'business-review', businessId: B },
      { screen: 'appointment', appointmentId: '../../admin' },
      { screen: 'book' },
      { screen: 42 },
      null,
    ]) {
      expect(linkFor(data)).toBeNull();
    }
  });
});

describe('when it came', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  it('reads naturally', () => {
    expect(ago('2026-10-05T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-10-05T11:55:00Z', now)).toBe('5 min ago');
    expect(ago('2026-10-05T09:00:00Z', now)).toBe('3 h ago');
    expect(ago('2026-10-04T10:00:00Z', now)).toBe('yesterday');
    expect(ago('2026-10-01T10:00:00Z', now)).toBe('1 Oct');
    expect(ago('2025-12-25T10:00:00Z', now)).toBe('25 Dec 2025');
  });
});

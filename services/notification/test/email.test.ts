import { randomBytes } from 'node:crypto';
import { createBlindIndexer } from '@buku/common';
import { describe, expect, it } from 'vitest';
import {
  checkUnsubscribeSignature,
  renderEmail,
  unsubscribeSignature,
  webPath,
} from '../src/email/render.js';
import { toAccount, toCustomer, type Visit } from '../src/messages.js';

const indexer = createBlindIndexer(randomBytes(32));
const links = { webAppUrl: 'https://buku.app', publicApiUrl: 'https://api.buku.app', indexer };
const userId = '0190a1b2-0000-7000-8000-00000000000a';
const visit: Visit = {
  appointmentId: '0190a1b2-0000-7000-8000-000000000001',
  businessId: '0190a1b2-0000-7000-8000-000000000002',
  businessName: 'Fade <Studio> & Co',
  serviceName: 'Haircut',
  staffName: null,
  customerName: 'Ayesha Khan',
  code: 'BK-7Q4M2X',
  startAt: new Date('2026-10-10T05:30:00Z'),
  timezone: 'Asia/Karachi',
};

describe('Emails', () => {
  it('escape everything people typed, and link into the app', () => {
    const m = renderEmail(
      'a@example.test',
      userId,
      toCustomer.cancelledByBusiness(visit, '<script>x</script>'),
      links,
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('Fade &lt;Studio&gt; &amp; Co');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.text).toContain(`https://buku.app/appointments/${visit.appointmentId}`);
    expect(m.subject).toBe('Booking cancelled');
  });

  it('carry a one-click unsubscribe for exactly their kind; plan notices have none', () => {
    const m = renderEmail('a@example.test', userId, toCustomer.reminder24h(visit), links);
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const url = new URL(m.headers!['List-Unsubscribe']!.slice(1, -1));
    expect(url.origin + url.pathname).toBe('https://api.buku.app/v1/notifications/unsubscribe');
    expect(url.searchParams.get('p')).toBe('emailReminders');
    expect(checkUnsubscribeSignature(indexer, userId, 'emailReminders', url.searchParams.get('s')!)).toBe(
      true,
    );

    const notice = renderEmail(
      'a@example.test',
      userId,
      toAccount.trialEnding({
        businessId: null,
        businessName: null,
        planName: 'Plus',
        endsAt: new Date(),
        timezone: 'UTC',
      }),
      links,
    );
    expect(notice.headers).toBeUndefined();
    expect(notice.text).toContain('always sent');
  });

  it('an unsubscribe signature works only for that person and that kind of email', () => {
    const s = unsubscribeSignature(indexer, userId, 'emailReminders');
    expect(checkUnsubscribeSignature(indexer, userId, 'emailBookingConfirmation', s)).toBe(false);
    expect(
      checkUnsubscribeSignature(indexer, '0190a1b2-0000-7000-8000-00000000000b', 'emailReminders', s),
    ).toBe(false);
    expect(checkUnsubscribeSignature(createBlindIndexer(randomBytes(32)), userId, 'emailReminders', s)).toBe(
      false,
    );
    expect(checkUnsubscribeSignature(indexer, userId, 'emailReminders', 'short')).toBe(false);
  });

  it('web paths for every screen, with ids encoded', () => {
    expect(webPath({ screen: 'book', businessId: 'b', serviceId: 's' })).toBe('/b/b?service=s');
    expect(webPath({ screen: 'queue-ticket', entryId: '../x' })).toBe('/queue/..%2Fx');
    expect(webPath({ screen: 'business-billing', businessId: 'b' })).toBe('/business/b/billing');
    expect(webPath({ screen: 'nope' })).toBe('/');
  });
});

import { Contact } from '@/components/content/legal-doc';
import type { SiteFacts } from '@/lib/site';
import type { LegalDocument } from './types';

/** Refunds: business subscriptions go through Paddle; appointment payments never touch BUKU. */
export function refunds(facts: SiteFacts): LegalDocument {
  return {
    title: 'Cancellations and refunds',
    description: 'How cancelling a business plan works, and who to ask about refunds.',
    version: '1.0',
    inShort: [
      'BUKU is free for people who book and queue, so there’s nothing for them to cancel or refund.',
      'A business can cancel its plan at any time and keep it until the end of the period it paid for.',
      'Subscriptions are sold by Paddle, our payment partner, which handles refunds.',
      'BUKU never takes payment for appointments: refunds for a visit are between you and the business.',
    ],
    sections: [
      {
        id: 'cancelling',
        title: 'Cancelling a subscription',
        body: (
          <ul>
            <li>Cancel any time from your business’s billing page. There is no cancellation fee.</li>
            <li>
              Your plan stays active until the end of the period you’ve paid for, then it stops renewing.
            </li>
            <li>
              Changed your mind before the period ends? You can undo the cancellation from the same page.
            </li>
            <li>A free trial ends by itself; you’re never charged for it.</li>
          </ul>
        ),
      },
      {
        id: 'refunds',
        title: 'Refunds',
        body: (
          <p>
            Paddle is the seller of BUKU subscriptions (the “merchant of record”): it takes the payment,
            handles tax and processes refunds under its buyer terms, which you see when you pay. To ask for a
            refund, use the link in your Paddle receipt, or write to us at{' '}
            <Contact value={facts.email.support} kind="email" /> and we’ll help.
          </p>
        ),
      },
      {
        id: 'appointments',
        title: 'Appointments',
        body: (
          <p>
            Appointments are paid at the business, so BUKU can’t refund them. If something went wrong with a
            visit, talk to the business first; if that doesn’t solve it, you can tell us and report the
            business in BUKU.
          </p>
        ),
      },
    ],
  };
}

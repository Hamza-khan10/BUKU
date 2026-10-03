import Link from 'next/link';
import { Contact } from '@/components/content/legal-doc';
import { TERMS_VERSION } from '@/lib/legal-versions';
import type { SiteFacts } from '@/lib/site';
import type { LegalDocument } from './types';

/** Terms of use for people who book and queue. Rules quoted here are the system's own. */
export function terms(facts: SiteFacts): LegalDocument {
  return {
    title: 'Terms of use',
    description: 'The agreement between you and BUKU when you book appointments and join queues.',
    version: TERMS_VERSION,
    inShort: [
      'A booking is an agreement between you and the business; BUKU makes it easy to make and keep.',
      'Appointments are paid at the business, never through BUKU.',
      'Cancel before the business’s notice period if you can’t come — late cancellations and no-shows count towards the reliability label businesses see.',
      'Reviews are for real visits: one per completed visit, within 30 days.',
    ],
    sections: [
      {
        id: 'about',
        title: 'About these terms',
        body: (
          <>
            <p>
              These terms apply when you use BUKU to find businesses, book appointments or join queues, on the
              website or in the apps. BUKU is run by <Contact value={facts.legalName} kind="text" />. By
              creating an account you agree to them and to the{' '}
              <Link href="/legal/privacy">privacy notice</Link>.
            </p>
            <p>
              Businesses using BUKU agree to the separate{' '}
              <Link href="/legal/business-terms">business terms</Link>.
            </p>
          </>
        ),
      },
      {
        id: 'account',
        title: 'Your account',
        body: (
          <ul>
            <li>You sign in with Google (or Apple where offered). One account per person.</li>
            <li>
              Keep your sign-in secure; you can see and end your signed-in devices in your account settings.
            </li>
            <li>The name on your account should be one businesses can call you by.</li>
            <li>
              You can delete your account at any time. You then have 30 days to change your mind by signing in
              again.
            </li>
          </ul>
        ),
      },
      {
        id: 'bookings',
        title: 'Bookings',
        body: (
          <>
            <p>
              When you book, you agree with the business on a service, a time and a price. The business
              provides the service and sets its prices, its notice period for cancelling and whether it
              approves bookings before confirming them. BUKU shows you all of this before you book.
            </p>
            <ul>
              <li>Payment for the appointment happens at the business. BUKU never takes it.</li>
              <li>Your booking code (and its QR code) is how the business checks you in.</li>
              <li>
                You can cancel or move a booking in BUKU. Cancelling within the business’s notice period is
                recorded as a late cancellation.
              </li>
              <li>
                If you don’t arrive, the business can mark the booking as a no-show after a short grace
                period.
              </li>
              <li>
                A business may limit how many upcoming bookings one person has with it, and may cancel a
                booking (with a reason that you’ll see).
              </li>
            </ul>
          </>
        ),
      },
      {
        id: 'queues',
        title: 'Queues',
        body: (
          <ul>
            <li>
              You can join a business’s queue from nearby — within a distance the business sets (5 km unless
              it chooses otherwise). Your browser or phone asks before sharing your location.
            </li>
            <li>You can hold one queue ticket at a time, anywhere on BUKU.</li>
            <li>
              When it’s your turn, you’re called; if you don’t come to the counter within the business’s grace
              time, the next person is served.
            </li>
            <li>Waiting times are estimates from the day so far; they can change.</li>
          </ul>
        ),
      },
      {
        id: 'reliability',
        title: 'Reliability labels',
        body: (
          <p>
            Businesses see a simple label about how reliably you turn up, such as “Shows up 95%” or “New
            customer”, worked out from your own bookings and queue tickets. They never see your history with
            other businesses. A business may ask to approve bookings from people who often don’t turn up.
          </p>
        ),
      },
      {
        id: 'reviews',
        title: 'Reviews',
        body: (
          <ul>
            <li>You can review a visit once it’s completed, within 30 days, once per visit.</li>
            <li>You can edit a review for 7 days and delete it at any time.</li>
            <li>Reviews show your first name and last initial. The business may reply publicly.</li>
            <li>
              Reviews must be about your own visit and follow the{' '}
              <Link href="/legal/acceptable-use">acceptable use rules</Link>; reviews that break them can be
              hidden after they’re reported.
            </li>
          </ul>
        ),
      },
      {
        id: 'plans',
        title: 'Free use and BUKU Plus',
        body: (
          <p>
            BUKU can be used for free, with a limit on bookings and queue joins; BUKU Plus removes the limit.
            Current limits and prices are on the pricing page. Subscriptions are sold and billed by Paddle,
            our payment partner; you can cancel at any time and keep BUKU Plus until the end of the period you
            paid for (see <Link href="/legal/refunds">refunds</Link>).
          </p>
        ),
      },
      {
        id: 'messages',
        title: 'Messages we send',
        body: (
          <p>
            We send messages about your bookings and queue tickets (confirmations, reminders, your turn).
            Suggestions and marketing only if you choose them. You decide which channels we use in your
            notification settings.
          </p>
        ),
      },
      {
        id: 'rules',
        title: 'Using BUKU fairly',
        body: (
          <p>
            Please follow the <Link href="/legal/acceptable-use">acceptable use rules</Link>. We may limit or
            close accounts that break them — for example, fake bookings or reviews — and we’ll tell you why
            unless the law prevents it.
          </p>
        ),
      },
      {
        id: 'liability',
        title: 'Our responsibility',
        body: (
          <p>
            We work hard to keep BUKU available and accurate, but businesses are responsible for the services
            they provide, their prices and keeping their bookings. Nothing in these terms limits rights you
            have by law as a consumer.
          </p>
        ),
      },
      {
        id: 'law-and-changes',
        title: 'Changes, law and contact',
        body: (
          <>
            <p>
              If we change these terms in a way that matters, we’ll tell you in BUKU first and ask you to
              agree to the new version. These terms are governed by the law of{' '}
              <Contact value={facts.jurisdiction} kind="text" />.
            </p>
            <p>
              Questions: <Contact value={facts.email.support} kind="email" />.
            </p>
          </>
        ),
      },
    ],
  };
}

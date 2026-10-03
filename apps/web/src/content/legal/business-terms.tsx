import Link from 'next/link';
import { Contact } from '@/components/content/legal-doc';
import { BUSINESS_TERMS_VERSION } from '@/lib/legal-versions';
import type { SiteFacts } from '@/lib/site';
import type { LegalDocument } from './types';

/** Terms for businesses that take bookings and run queues with BUKU. */
export function businessTerms(facts: SiteFacts): LegalDocument {
  return {
    title: 'Business terms',
    description: 'The agreement between BUKU and businesses that take bookings and run queues with it.',
    version: BUSINESS_TERMS_VERSION,
    inShort: [
      'Your profile shows “Not verified” until BUKU has checked your business documents.',
      'You set your services, prices, hours and rules; customers rely on them, so keep them accurate.',
      'You see what you need to serve customers — their name, booking and a reliability label — and use it only for that.',
      'You can reply to reviews and report ones that break the rules, but not remove them.',
    ],
    sections: [
      {
        id: 'about',
        title: 'About these terms',
        body: (
          <p>
            These terms apply to businesses using BUKU to take bookings and run queues, and to the people who
            manage them. BUKU is run by <Contact value={facts.legalName} kind="text" />. The person who
            registers the business accepts them for the business. Customers agree to the separate{' '}
            <Link href="/legal/terms">terms of use</Link>.
          </p>
        ),
      },
      {
        id: 'verification',
        title: 'Registering and verification',
        body: (
          <ul>
            <li>
              Your profile is public as soon as you publish it, labelled “Not verified” until BUKU has
              reviewed your legal details and documents.
            </li>
            <li>
              The information you give must be true and current. Documents are stored encrypted and seen only
              by the BUKU staff who check them.
            </li>
            <li>BUKU may ask for more information, or decline or remove a listing that isn’t genuine.</li>
          </ul>
        ),
      },
      {
        id: 'your-team',
        title: 'Your team',
        body: (
          <ul>
            <li>
              The owner can create accounts for the team, with roles — manager, front desk, staff — that
              decide what each person can do.
            </li>
            <li>
              You are responsible for what your team does in BUKU. Removing someone from the team ends their
              access at once.
            </li>
          </ul>
        ),
      },
      {
        id: 'bookings-and-queues',
        title: 'Bookings and queues',
        body: (
          <ul>
            <li>
              You set your services, prices, durations, opening hours, closures, notice period for
              cancellations and whether you approve bookings first. Keep them accurate: customers book on
              them.
            </li>
            <li>Honour the bookings you confirm. If you must cancel one, give the customer the reason.</li>
            <li>Appointments are paid at your business; BUKU does not collect or hold that money.</li>
            <li>The waiting-room screen shows ticket numbers only — never customers’ names.</li>
          </ul>
        ),
      },
      {
        id: 'customer-data',
        title: 'Your customers’ data',
        body: (
          <p>
            You see your customers’ names, their bookings, notes they write for you, and a reliability label.
            Use this only to serve them, keep it confidential, and don’t contact customers through BUKU for
            anything else. For your own records about your customers you are responsible under data protection
            law; BUKU is responsible for running the platform (see the{' '}
            <Link href="/legal/privacy">privacy notice</Link>).
          </p>
        ),
      },
      {
        id: 'reviews',
        title: 'Reviews',
        body: (
          <p>
            Only customers with a completed visit can review you. You may reply publicly and report a review
            that breaks the <Link href="/legal/acceptable-use">acceptable use rules</Link>; BUKU decides on
            reports. You can’t edit, remove or pay for reviews.
          </p>
        ),
      },
      {
        id: 'plans',
        title: 'Plans and billing',
        body: (
          <p>
            Plans set limits such as team logins, services and photos; the current plans, limits and prices
            are on the pricing page. Paid plans are sold and billed by Paddle, our payment partner. You can
            change or cancel a plan at any time; a change takes effect as shown before you confirm it.
          </p>
        ),
      },
      {
        id: 'suspension',
        title: 'Suspension and closing',
        body: (
          <p>
            BUKU may suspend a business that misleads customers, breaks these terms or the law; we’ll tell you
            why unless the law prevents it. You can close your business on BUKU at any time; verification
            documents are deleted one year after closing.
          </p>
        ),
      },
      {
        id: 'law-and-changes',
        title: 'Changes, law and contact',
        body: (
          <>
            <p>
              We’ll tell you before changes to these terms take effect. They are governed by the law of{' '}
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

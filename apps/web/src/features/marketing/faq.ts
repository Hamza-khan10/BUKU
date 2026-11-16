/**
 * Questions businesses ask, answered plainly (D-136). One source for the questions on /for-business,
 * their structured data (FAQPage) and /llms.txt, so what search and answer engines read is exactly
 * what people read. Every answer is something BUKU does today; keep them in step when that changes.
 */
export interface Question {
  id: string;
  q: string;
  a: string;
}

export const BUSINESS_QUESTIONS: readonly Question[] = [
  {
    id: 'what',
    q: 'What is BUKU?',
    a: 'BUKU is an app for booking appointments and joining walk-in queues at local businesses such as barbers, clinics, salons and offices. Businesses use it to take bookings from their real availability and to run a queue that customers join from their phone.',
  },
  {
    id: 'cost',
    q: 'How much does BUKU cost?',
    a: 'Booking and queueing are free for customers, always. For businesses, the Starter plan is free, and paid plans add more. Every business can try the Professional plan free for 30 days. Prices are published at launch.',
  },
  {
    id: 'queue',
    q: 'How does the walk-in queue work?',
    a: 'Customers take a ticket from their phone before they arrive and watch the line move. The business calls the next ticket, adds walk-ins, can use a priority lane, and can pause or close the queue at any time.',
  },
  {
    id: 'check-in',
    q: 'How do customers check in?',
    a: 'Every booking has a code. The front desk scans its QR code or types it in, the visit is checked in, and the day’s list stays right.',
  },
  {
    id: 'team',
    q: 'Can my staff use BUKU?',
    a: 'Yes. Each person gets their own login with a role (manager, front desk or staff), so they see what they need. Removing someone ends their access at once.',
  },
  {
    id: 'branches',
    q: 'Does BUKU work for a business with several branches?',
    a: 'Yes. Each branch is its own business on BUKU, with its own hours, team, services and queue, and you switch between them from one account.',
  },
  {
    id: 'payments',
    q: 'Do customers pay through BUKU?',
    a: 'No. Appointments are paid at the business, as usual. BUKU never charges the customer or the business for an appointment itself.',
  },
  {
    id: 'when',
    q: 'When and where does BUKU open?',
    a: 'BUKU opens in Pakistan first. Join the early-access list and we’ll email you the day it opens near you; businesses on the list also get help to set up.',
  },
];

/** The questions as schema.org FAQPage, for search and answer engines. */
export function faqStructuredData(questions: readonly Question[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

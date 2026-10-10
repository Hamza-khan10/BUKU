import Link from 'next/link';
import type { ReactNode } from 'react';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Container, PageHeading } from '@/components/ui/layout';

export const metadata = {
  title: 'Help',
  description: 'Answers about booking, queues, your account, notifications, reviews and businesses on BUKU.',
};

/**
 * Honest answers. Every rule quoted here is the system's own (booking,
 * queue, review and account rules); keep them in step when those change.
 */
const TOPICS: { id: string; title: string; questions: { id: string; q: string; a: ReactNode }[] }[] = [
  {
    id: 'booking',
    title: 'Booking',
    questions: [
      {
        id: 'pay',
        q: 'Do I pay through BUKU?',
        a: (
          <p>
            No. Appointments are paid at the business, as you normally would. BUKU never takes payment for a
            visit.
          </p>
        ),
      },
      {
        id: 'cancel',
        q: 'How do I cancel or move a booking?',
        a: (
          <>
            <p>
              Open the booking and choose cancel or move. Each business sets how much notice it needs;
              cancelling later than that is recorded as a late cancellation. BUKU tells you before you
              confirm.
            </p>
            <p>When you cancel, you can ask BUKU to remind you to book again later.</p>
          </>
        ),
      },
      {
        id: 'pending',
        q: 'What does “Pending approval” mean?',
        a: (
          <p>
            Some businesses confirm each booking themselves. Your time is held while they decide, and you’re
            told as soon as they confirm or decline.
          </p>
        ),
      },
      {
        id: 'taken',
        q: 'The time I wanted was taken while I was choosing. What now?',
        a: (
          <p>
            BUKU only ever books a time that’s still free. If someone else took it first, you’ll see the next
            free times straight away.
          </p>
        ),
      },
      {
        id: 'reminders',
        q: 'When do reminders arrive?',
        a: (
          <p>
            The day before (if you booked more than a day ahead) and about two hours before, never during the
            night where the business is. You can turn either off in your notification settings.
          </p>
        ),
      },
    ],
  },
  {
    id: 'queues',
    title: 'Queues',
    questions: [
      {
        id: 'how',
        q: 'How do queues work?',
        a: (
          <p>
            Join a business’s queue from nearby and you get a ticket. You can see how many people are ahead
            and an estimated wait, and you get a nudge as your turn gets close and when you’re called. See{' '}
            <Link href="/how-it-works">how it works</Link>.
          </p>
        ),
      },
      {
        id: 'cant-join',
        q: 'Why can’t I join a queue?',
        a: (
          <>
            <p>One of these is usually the reason, and BUKU tells you which:</p>
            <ul className="mt-2 list-disc pl-5">
              <li>You’re further away than the business allows (5 km unless it sets another distance).</li>
              <li>You already have a ticket in another queue. You can hold one at a time.</li>
              <li>The queue is paused or closed right now.</li>
              <li>Your location is turned off for BUKU in your browser or phone.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'missed',
        q: 'What if I miss my turn?',
        a: (
          <p>
            When you’re called, the business waits a short grace time. If you don’t come to the counter by
            then, the next person is served and your ticket is marked as missed.
          </p>
        ),
      },
    ],
  },
  {
    id: 'account',
    title: 'Your account',
    questions: [
      {
        id: 'sign-in',
        q: 'How do I sign in?',
        a: (
          <p>
            With your Google account. Staff of a business sign in with the username and password their
            business gives them.
          </p>
        ),
      },
      {
        id: 'two-step',
        q: 'Can I add two-step sign-in?',
        a: (
          <p>
            Yes, with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and
            others), from your account settings.
          </p>
        ),
      },
      {
        id: 'data',
        q: 'Can I see the data BUKU has about me?',
        a: (
          <p>
            Yes. Download all of it from your account settings. The{' '}
            <Link href="/legal/privacy">privacy notice</Link> explains what each part is for.
          </p>
        ),
      },
      {
        id: 'delete',
        q: 'How do I delete my account?',
        a: (
          <p>
            From your account settings. You then have 30 days to change your mind by signing in again; after
            that your personal data is erased for good. Bookings and ratings stay only without your name.
          </p>
        ),
      },
    ],
  },
  {
    id: 'reviews',
    title: 'Reviews and reliability',
    questions: [
      {
        id: 'who-reviews',
        q: 'Who can write a review?',
        a: (
          <p>
            Only someone whose visit was completed, within 30 days, once per visit. Reviews can be edited for
            7 days and deleted any time.
          </p>
        ),
      },
      {
        id: 'reliability',
        q: 'What do businesses see about me?',
        a: (
          <p>
            Your name, your booking, any note you write, and a label like “Shows up 95%” or “New customer”,
            never your phone number, email, picture or your history with other businesses.
          </p>
        ),
      },
    ],
  },
  {
    id: 'businesses',
    title: 'Businesses',
    questions: [
      {
        id: 'not-verified',
        q: 'What does “Not verified” mean?',
        a: (
          <p>
            BUKU hasn’t yet checked that business’s legal details and documents. It can still take bookings;
            the label goes away once it has been checked.
          </p>
        ),
      },
      {
        id: 'report',
        q: 'Something about a business looks wrong',
        a: (
          <p>
            Use “Report” on its page. Every report is looked at, and you can say what’s wrong in your own
            words.
          </p>
        ),
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <Container className="flex flex-col gap-12 py-12 sm:py-16">
      <PageHeading
        eyebrow="Help"
        title="How can we help?"
        description="Short answers to the questions people ask most. Can’t find yours? Contact us."
      />
      <nav aria-label="Topics" className="flex flex-wrap gap-2">
        {TOPICS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink-2 hover:text-ink"
          >
            {t.title}
          </a>
        ))}
      </nav>
      {TOPICS.map((t) => (
        <section
          key={t.id}
          id={t.id}
          aria-labelledby={`${t.id}-title`}
          className="flex scroll-mt-24 flex-col gap-4"
        >
          <h2 id={`${t.id}-title`} className="text-2xl font-semibold tracking-[-0.025em]">
            {t.title}
          </h2>
          <Accordion type="multiple">
            {t.questions.map((item) => (
              <AccordionItem key={item.id} value={`${t.id}-${item.id}`} question={item.q}>
                {item.a}
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      ))}
      <p className="text-ink-2">
        Still stuck?{' '}
        <Link href="/contact" className="font-medium text-brand-ink underline underline-offset-4">
          Contact us
        </Link>
        .
      </p>
    </Container>
  );
}

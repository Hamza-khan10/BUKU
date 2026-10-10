import {
  BellRing,
  CalendarCheck,
  MapPin,
  QrCode,
  Search,
  Star,
  Ticket as TicketIcon,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Container, PageHeading } from '@/components/ui/layout';
import { Ticket } from '@/components/ui/ticket';

export const metadata = {
  title: 'How it works',
  description: 'Booking an appointment and joining a queue with BUKU, step by step.',
};

interface Step {
  Icon: LucideIcon;
  title: string;
  text: string;
}

const BOOKING: Step[] = [
  {
    Icon: Search,
    title: 'Find a place',
    text: 'Search by name, service or category, or see what’s near you and open now.',
  },
  {
    Icon: CalendarCheck,
    title: 'Pick a service and a free time',
    text: 'You only see times that are really free. Choose a person, or whoever is available.',
  },
  {
    Icon: TicketIcon,
    title: 'Get your ticket',
    text: 'Your booking comes with a code and a QR code. Some businesses confirm bookings first: you’ll see “Pending approval” until they do.',
  },
  {
    Icon: BellRing,
    title: 'Get reminded',
    text: 'A reminder the day before and a couple of hours before (never in the middle of the night). Plans changed? Cancel or move it in a tap.',
  },
  { Icon: QrCode, title: 'Check in', text: 'Show your code at the front desk; they scan it or type it in.' },
  {
    Icon: Star,
    title: 'Review your visit',
    text: 'Within 30 days, one review per visit, so every review comes from a real visit.',
  },
];

const QUEUE: Step[] = [
  {
    Icon: MapPin,
    title: 'Join from nearby',
    text: 'Take a ticket before you arrive, from within the distance the business sets.',
  },
  {
    Icon: Users,
    title: 'Watch the line move',
    text: 'See how many people are ahead of you and a waiting time worked out from today so far.',
  },
  {
    Icon: BellRing,
    title: 'Get a heads-up',
    text: 'A nudge as your turn gets close, and when you’re called.',
  },
  {
    Icon: TicketIcon,
    title: 'Come to the counter',
    text: 'When you’re called, come over. One ticket at a time keeps it fair for everyone.',
  },
];

function Steps({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-6">
      {steps.map(({ Icon, title, text }, i) => (
        <li key={title} className="flex gap-4">
          <span className="flex flex-col items-center">
            <span className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-2">
              <Icon className="size-5" aria-hidden />
            </span>
            {i < steps.length - 1 && <span aria-hidden className="mt-2 w-px flex-1 bg-line" />}
          </span>
          <span className="flex flex-col gap-1.5 pb-4">
            <span className="text-xl font-semibold tracking-[-0.02em]">
              <span className="tabular mr-2 text-ink-3">{i + 1}</span>
              {title}
            </span>
            <span className="leading-relaxed text-ink-2">{text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function HowItWorksPage() {
  return (
    <Container className="flex flex-col gap-20 py-12 sm:py-16">
      <PageHeading
        eyebrow="How it works"
        title="Book a time, or join the line from your phone"
        description="Two ways to stop waiting without knowing how long: an appointment at a time that suits you, or a place in the queue you can watch move."
      />

      <section aria-labelledby="booking" className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <h2 id="booking" className="text-3xl font-semibold tracking-[-0.03em]">
            Booking an appointment
          </h2>
          <Steps steps={BOOKING} label="Booking an appointment, step by step" />
        </div>
        <figure className="flex flex-col gap-3 lg:sticky lg:top-24">
          <Ticket
            qr
            title="Haircut with Ali"
            place="Example Barbers"
            when="Thu 9 Oct · 10:30–11:00"
            details={<span>Pay at the venue</span>}
            code="BK-7KQ2MX"
            codeLabel="Booking code"
            status={{ label: 'Confirmed', tone: 'ok' }}
          />
          <figcaption className="text-sm text-ink-3">
            Illustration: what a booking ticket looks like.
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="queue" className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <h2 id="queue" className="text-3xl font-semibold tracking-[-0.03em]">
            Joining a queue
          </h2>
          <Steps steps={QUEUE} label="Joining a queue, step by step" />
        </div>
        <figure className="flex flex-col gap-3 lg:sticky lg:top-24">
          <Ticket
            title="Walk-in queue"
            place="Example Clinic"
            when="3 people ahead of you · about 20 min"
            code="A-023"
            codeLabel="Your ticket"
            status={{ label: 'In the queue, updating live', tone: 'wait', live: true }}
          />
          <figcaption className="text-sm text-ink-3">Illustration: a queue ticket updating live.</figcaption>
        </figure>
      </section>
    </Container>
  );
}

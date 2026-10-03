import { CalendarCheck, Clock, Ticket as TicketIcon } from 'lucide-react';
import { Container } from '@/components/ui/layout';

/**
 * The home page's first version: what BUKU is, in its own words. The full
 * landing page — live discovery, categories, plans — arrives with the public
 * site (step 3.2). Every sentence here describes something BUKU does today.
 */
export default function HomePage() {
  const points = [
    {
      Icon: CalendarCheck,
      title: 'Book a time',
      text: 'See a business’s real free times and book one in a few taps. Your booking code works at the front desk.',
    },
    {
      Icon: TicketIcon,
      title: 'Join the queue from anywhere nearby',
      text: 'Take a ticket before you arrive and watch your place in line move, instead of standing in it.',
    },
    {
      Icon: Clock,
      title: 'Get reminded',
      text: 'Reminders before your visit and a nudge when it’s almost your turn, on the channels you choose.',
    },
  ];
  return (
    <Container className="flex flex-col gap-16 pt-16 sm:pt-24">
      <section className="flex max-w-3xl flex-col gap-6 animate-rise">
        <p className="text-sm font-semibold tracking-wide text-brand-ink uppercase">
          Appointments and queues
        </p>
        <h1 className="font-display text-5xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
          Know exactly when. <span className="text-brand-ink">It’s handled.</span>
        </h1>
        <p className="max-w-2xl text-lg text-ink-2 sm:text-xl">
          BUKU lets you book appointments and join queues at local businesses — and see, live, when it’s your
          turn.
        </p>
      </section>

      <section aria-label="What BUKU does" className="grid gap-4 sm:grid-cols-3">
        {points.map(({ Icon, title, text }) => (
          <div
            key={title}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-6 shadow-soft"
          >
            <span className="grid size-11 place-items-center rounded-md bg-brand-soft text-brand-ink">
              <Icon className="size-5" aria-hidden />
            </span>
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            <p className="text-ink-2">{text}</p>
          </div>
        ))}
      </section>
    </Container>
  );
}

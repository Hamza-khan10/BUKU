import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BellRing,
  CalendarCheck,
  Gauge,
  MessageSquareQuote,
  QrCode,
  Store,
  Ticket as TicketIcon,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout';
import { Ticket } from '@/components/ui/ticket';
import { pricing } from '@/features/pricing/api';

export const metadata = {
  title: 'For businesses',
  description:
    'Take bookings from your real availability, run your walk-in queue, check customers in by QR code, and see who turns up.',
};

/**
 * What BUKU gives a business — each card is something the platform does
 * today (booking, queue, check-in, reminders, reliability, team roles,
 * reviews, insights, the public page, verification). Nothing planned is
 * described as if it existed.
 */
const FEATURES: { Icon: LucideIcon; title: string; text: string }[] = [
  {
    Icon: CalendarCheck,
    title: 'Bookings from your real availability',
    text: 'Opening hours, closures, each person’s hours and time off — customers only ever see times that are free. Confirm automatically, or approve each booking yourself.',
  },
  {
    Icon: TicketIcon,
    title: 'A walk-in queue people can join from nearby',
    text: 'Customers take a ticket before they arrive and watch the line move. You call the next ticket, add walk-ins, use a priority lane, and pause or close the queue.',
  },
  {
    Icon: QrCode,
    title: 'Check-in by code or QR',
    text: 'Every booking has a code. The front desk scans it or types it — the visit is checked in and the day’s list stays right.',
  },
  {
    Icon: BellRing,
    title: 'Reminders, sent for you',
    text: 'Customers get a reminder the day before and a couple of hours before — never in the middle of the night where you are.',
  },
  {
    Icon: Gauge,
    title: 'Know who turns up',
    text: 'Each customer comes with a simple reliability label. If you want, bookings from people who often don’t turn up wait for your approval.',
  },
  {
    Icon: Users,
    title: 'Your team, with the right access',
    text: 'Logins for your staff with roles — manager, front desk, staff — so everyone sees what they need. Removing someone ends their access at once.',
  },
  {
    Icon: MessageSquareQuote,
    title: 'Reviews only from real visits',
    text: 'Only customers whose visit was completed can review you, once. Reply in public, and report anything that breaks the rules.',
  },
  {
    Icon: BarChart3,
    title: 'Cancellations and no-shows, in numbers',
    text: 'See late cancellations and no-shows over time, so you can set the notice period that suits you.',
  },
  {
    Icon: Store,
    title: 'Your own page',
    text: 'Services and prices, team, opening hours, photos, directions and your live queue — one link to share anywhere.',
  },
];

const STEPS = [
  'Sign in and add your business: name, category, address and opening hours.',
  'Add your services and prices, and your team if you have one.',
  'Your page goes live at once, labelled “Not verified”.',
  'Send your registration details; once BUKU has checked them, your page says “Verified business”.',
];

export default async function ForBusinessPage() {
  const plans = await pricing('business').catch(() => null);
  return (
    <div className="flex flex-col gap-20 pb-8 sm:gap-24">
      <section className="border-b border-line bg-[radial-gradient(ellipse_at_top_left,color-mix(in_srgb,var(--wait)_14%,transparent),transparent_55%)]">
        <Container className="grid grid-cols-1 items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6 animate-rise">
            <p className="text-sm font-semibold tracking-wide text-brand-ink uppercase">For businesses</p>
            <h1 className="font-display text-5xl leading-[1.04] font-bold tracking-tight sm:text-6xl">
              A calm front desk, a full day.
            </h1>
            <p className="max-w-xl text-lg text-ink-2 sm:text-xl">
              BUKU takes your bookings and runs your walk-in queue, so your customers know exactly when — and
              your team can focus on the people in front of them.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="primary" size="lg">
                <Link href="/pricing#businesses">See plans and prices</Link>
              </Button>
              <Button asChild size="lg">
                <Link href="/how-it-works">How it works for customers</Link>
              </Button>
            </div>
            {plans && !plans.billingEnabled && (
              <p className="text-sm text-ink-3">
                Paid plans aren’t switched on yet: right now everything is included.
              </p>
            )}
          </div>
          <figure className="hidden flex-col items-center gap-3 lg:flex">
            <Ticket
              title="Walk-in queue"
              place="Example Clinic"
              when="Now serving A-021 · 4 waiting"
              code="A-025"
              codeLabel="Next ticket"
              status={{ label: 'Queue open — updates live', tone: 'wait', live: true }}
            />
            <figcaption className="text-sm text-ink-3">Example: a queue as your customers see it</figcaption>
          </figure>
        </Container>
      </section>

      <Container>
        <section aria-labelledby="what" className="flex flex-col gap-8">
          <h2 id="what" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Everything the front desk needs
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ Icon, title, text }) => (
              <li
                key={title}
                className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-6 shadow-soft"
              >
                <span className="grid size-11 place-items-center rounded-md bg-brand-soft text-brand-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="font-display text-lg font-semibold">{title}</h3>
                <p className="text-ink-2">{text}</p>
              </li>
            ))}
          </ul>
        </section>
      </Container>

      <Container>
        <section
          aria-labelledby="start"
          className="grid grid-cols-1 gap-10 rounded-2xl border border-line bg-night p-8 text-[#f6f2ec] sm:p-12 lg:grid-cols-2"
        >
          <div className="flex flex-col gap-4">
            <h2 id="start" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Getting started
            </h2>
            <p className="text-[#c5cbd6]">
              Your customers’ phone numbers and emails stay with BUKU — you see their name, their booking and
              a reliability label. Appointments are paid at your business, never through BUKU.
            </p>
            <p className="flex items-center gap-2 text-[#c5cbd6]">
              <BadgeCheck className="size-5 text-[#3dd69d]" aria-hidden /> Read the{' '}
              <Link
                href="/legal/business-terms"
                className="font-medium text-[#ff8c73] underline underline-offset-4"
              >
                business terms
              </Link>
            </p>
          </div>
          <ol className="flex flex-col gap-4">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#d4432a] font-semibold text-white tabular">
                  {i + 1}
                </span>
                <span className="pt-1.5 text-[#f6f2ec]">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </Container>

      <Container>
        <Link
          href="/pricing#businesses"
          className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
        >
          Compare business plans <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Container>
    </div>
  );
}

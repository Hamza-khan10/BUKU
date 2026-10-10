import { CalendarCheck, Store, Ticket as TicketIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout';
import { FrontDeskBoard } from '@/features/home/components/front-desk-board';
import { pricing } from '@/features/pricing/api';

export const metadata = {
  title: 'For businesses',
  description:
    'Take bookings from your real availability, run your walk-in queue, check customers in by QR code, and see who turns up.',
};

/**
 * What BUKU gives a business, grouped the way a front desk thinks: the
 * calendar, the queue, the team and the page. Each line is something the
 * platform does today; nothing planned is described as if it existed.
 */
const GROUPS: { Icon: LucideIcon; title: string; items: { title: string; text: string }[] }[] = [
  {
    Icon: CalendarCheck,
    title: 'Your calendar',
    items: [
      {
        title: 'Bookings from your real availability',
        text: 'Opening hours, closures, each person’s hours and time off. Customers only ever see times that are free. Confirm automatically, or approve each booking yourself.',
      },
      {
        title: 'Check-in by code or QR',
        text: 'Every booking has a code. The front desk scans it or types it, the visit is checked in, and the day’s list stays right.',
      },
      {
        title: 'Reminders, sent for you',
        text: 'Customers get a reminder the day before and a couple of hours before, never in the middle of the night where you are.',
      },
    ],
  },
  {
    Icon: TicketIcon,
    title: 'Your queue',
    items: [
      {
        title: 'A walk-in queue people join from nearby',
        text: 'Customers take a ticket before they arrive and watch the line move. You call the next ticket, add walk-ins, use a priority lane, and pause or close the queue.',
      },
      {
        title: 'Know who turns up',
        text: 'Each customer comes with a simple reliability label. If you want, bookings from people who often don’t turn up wait for your approval.',
      },
      {
        title: 'Cancellations and no-shows, in numbers',
        text: 'See late cancellations and no-shows over time, so you can set the notice period that suits you.',
      },
    ],
  },
  {
    Icon: Store,
    title: 'Your team and your page',
    items: [
      {
        title: 'Your team, with the right access',
        text: 'Logins for your staff with roles (manager, front desk, staff), so everyone sees what they need. Removing someone ends their access at once.',
      },
      {
        title: 'Reviews only from real visits',
        text: 'Only customers whose visit was completed can review you, once. Reply in public, and report anything that breaks the rules.',
      },
      {
        title: 'Your own page',
        text: 'Services and prices, team, opening hours, photos, directions and your live queue, at one link to share anywhere.',
      },
    ],
  },
];

const STEPS = [
  'Sign in and add your business: name, category, address and opening hours.',
  'Add your services and prices, and your team if you have one.',
  'Your page goes live at once, labelled “Not verified”.',
  'Send your registration details. Once BUKU has checked them, your page says “Verified business”.',
];

const sectionTitle = 'text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[3rem]';

export default async function ForBusinessPage() {
  const plans = await pricing('business').catch(() => null);
  return (
    <div className="flex flex-col gap-28 pb-8 sm:gap-36">
      <Container className="grid grid-cols-1 items-center gap-14 pt-12 sm:pt-20 lg:min-h-[calc(88dvh-4rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:pt-0">
        <div className="flex flex-col gap-7">
          <h1 className="text-[3rem] leading-[1] font-semibold tracking-[-0.045em] sm:text-[4.25rem] xl:text-[4.75rem]">
            A calm front desk, a full day.
          </h1>
          <p className="max-w-[34rem] text-xl leading-relaxed text-ink-2">
            BUKU takes your bookings and runs your walk-in queue, so customers know exactly when and your team
            can focus on the people in front of them.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild variant="primary" size="lg">
              <Link href="/pricing#businesses">See plans and prices</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/how-it-works">How it works for customers</Link>
            </Button>
          </div>
        </div>
        <FrontDeskBoard className="mx-auto w-full max-w-[30rem] lg:mr-0" />
      </Container>

      <Container>
        <section aria-labelledby="what" className="flex flex-col gap-12">
          <h2 id="what" className={sectionTitle}>
            Everything the front desk needs.
          </h2>
          <div className="grid gap-14 lg:grid-cols-3 lg:gap-10">
            {GROUPS.map(({ Icon, title, items }) => (
              <section key={title} aria-labelledby={`g-${title}`} className="flex flex-col gap-6">
                <h3
                  id={`g-${title}`}
                  className="flex items-center gap-3 text-lg font-semibold tracking-[-0.015em]"
                >
                  <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand-ink">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {title}
                </h3>
                <ul className="flex flex-col divide-y divide-line border-t border-line">
                  {items.map((item) => (
                    <li key={item.title} className="flex flex-col gap-2 py-6">
                      <h4 className="font-semibold tracking-[-0.01em] text-ink">{item.title}</h4>
                      <p className="leading-relaxed text-ink-2">{item.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      </Container>

      <Container>
        <section
          aria-labelledby="start"
          className="grid grid-cols-1 gap-12 rounded-2xl border border-line bg-surface p-8 shadow-soft sm:p-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
        >
          <div className="flex flex-col gap-5">
            <h2
              id="start"
              className="text-[2rem] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[2.5rem]"
            >
              Getting started.
            </h2>
            <p className="text-lg leading-relaxed text-ink-2">
              Your customers’ phone numbers and emails stay with BUKU: you see their name, their booking and a
              reliability label. Appointments are paid at your business, never through BUKU.
            </p>
            <p className="text-ink-2">
              Read the{' '}
              <Link
                href="/legal/business-terms"
                className="font-medium text-brand-ink underline underline-offset-4"
              >
                business terms
              </Link>
              .
            </p>
          </div>
          {/* A real sequence, so it's numbered. */}
          <ol className="flex flex-col gap-6">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-5">
                <span className="tabular grid size-10 shrink-0 place-items-center rounded-full border border-line font-semibold text-ink">
                  {i + 1}
                </span>
                <span className="pt-2 text-lg leading-relaxed text-ink">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </Container>

      <Container className="flex flex-col items-start gap-6">
        {plans && !plans.billingEnabled && (
          <Alert tone="ok" title="Paid plans aren’t switched on yet" className="max-w-xl">
            Right now everything is included, for every business.
          </Alert>
        )}
        <Link
          href="/pricing#businesses"
          className="font-medium text-brand-ink underline-offset-4 hover:underline"
        >
          Compare business plans
        </Link>
      </Container>
    </div>
  );
}

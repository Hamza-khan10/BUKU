import { CalendarCheck, Ticket } from 'lucide-react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Container, PageHeading } from '@/components/ui/layout';
import { ErrorState } from '@/components/ui/states';
import { pricing, type Pricing } from '@/features/pricing/api';
import { ComparisonTable, PlanCard } from '@/features/pricing/components/plans';
import { ApiError } from '@/lib/api/errors';

export const metadata = {
  title: 'Pricing',
  description:
    'Booking and queueing with BUKU are free for everyone. Businesses choose a plan: what each includes and what it costs.',
};

/**
 * People who book and queue use BUKU for free, with no limit (D-101). The
 * business plans come from the plan catalog (GET /v1/billing/plans), which
 * admins can change at any time (D-065); the page never states a number of
 * its own. While paid plans are switched off, it says so first.
 */

function BillingOff({ who }: { who: string }) {
  return (
    <Alert tone="ok" title={`Right now, everything is included for ${who}, at no cost`}>
      Paid plans aren’t switched on yet. These are the plans and prices that will apply when they are.
    </Alert>
  );
}

function taxNote(p: Pricing) {
  const prices = p.plans.flatMap((plan) => plan.prices);
  if (prices.length === 0) return null;
  return prices.every((x) => x.taxInclusive)
    ? 'Prices include tax.'
    : 'Prices are before tax; Paddle, our payment partner, adds tax where it applies.';
}

export default async function PricingPage() {
  const [result] = await Promise.allSettled([pricing('business', 'web')]);
  if (result.status === 'rejected') {
    const failure = result.reason as unknown;
    return (
      <Container className="py-16">
        <ErrorState
          title="Prices aren’t loading right now"
          message="Please try again in a moment."
          reference={failure instanceof ApiError ? failure.requestId : undefined}
        />
      </Container>
    );
  }
  const business = result.value;

  return (
    <Container className="flex flex-col gap-16 py-10 sm:py-14">
      <PageHeading
        eyebrow="Pricing"
        title="Free to book. Simple plans for businesses."
        description="Appointments are always paid at the business, never through BUKU. The plans below are only for businesses using BUKU."
      />

      <section
        id="customers"
        aria-labelledby="customers-title"
        className="flex scroll-mt-24 flex-col gap-6 rounded-2xl bg-brand-soft p-6 ring-1 ring-line sm:p-10"
      >
        <div className="flex flex-col gap-3">
          <h2 id="customers-title" className="type-section">
            For people booking and queueing: free
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-ink-2">
            Book any place and join any queue, as often as you like. No plan, no limit, no card.
          </p>
        </div>
        <ul className="grid gap-4 text-ink sm:grid-cols-2">
          <li className="flex gap-3">
            <CalendarCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-ink" />
            <span>
              Book at as many places as you like. Each business sets how many upcoming bookings one person can
              hold with it.
            </span>
          </li>
          <li className="flex gap-3">
            <Ticket aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-ink" />
            <span>
              One appointment at a time: BUKU won’t book you into two places at the same hour, and you wait in
              one queue at a time.
            </span>
          </li>
        </ul>
      </section>

      <section
        id="businesses"
        aria-labelledby="businesses-title"
        className="flex scroll-mt-24 flex-col gap-6"
      >
        <h2 id="businesses-title" className="type-section">
          For businesses
        </h2>
        {!business.billingEnabled && <BillingOff who="businesses" />}
        <ul className="grid gap-4 lg:grid-cols-3">
          {business.plans.map((p) => (
            <li key={p.code}>
              <PlanCard plan={p} trial={business.trial} highlight={business.trial?.plan.code === p.code} />
            </li>
          ))}
        </ul>
        <ComparisonTable pricing={business} />
        <div className="flex flex-col gap-1 text-sm text-ink-3">
          {business.trial && (
            <p>
              Try {business.trial.plan.name} free for {business.trial.days} days, once per business.
            </p>
          )}
          {taxNote(business) && <p>{taxNote(business)}</p>}
        </div>
      </section>

      <section aria-labelledby="questions" className="flex flex-col gap-3">
        <h2 id="questions" className="type-heading">
          Good to know
        </h2>
        <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5 text-ink-2">
          <li>
            Businesses can cancel any time and keep their plan until the end of the period they paid for.
          </li>
          <li>
            Subscriptions are sold and billed by Paddle, our payment partner. See{' '}
            <Link href="/legal/refunds" className="font-medium text-brand-ink underline underline-offset-4">
              cancellations and refunds
            </Link>
            .
          </li>
          <li>BUKU never charges you or the business for an appointment itself.</li>
        </ul>
      </section>
    </Container>
  );
}

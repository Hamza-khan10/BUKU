import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Container, PageHeading } from '@/components/ui/layout';
import { ErrorState } from '@/components/ui/states';
import { pricing, type Pricing } from '@/features/pricing/api';
import { ComparisonTable, PlanCard } from '@/features/pricing/components/plans';
import { ApiError } from '@/lib/api/errors';
import { money } from '@/lib/format';

export const metadata = {
  title: 'Pricing',
  description: 'BUKU’s plans for customers and businesses — what each includes and what it costs.',
};

/**
 * Every price, limit and plan on this page comes from the plan catalog
 * (GET /v1/billing/plans), which admins can change at any time (D-065); the
 * page never states a number of its own. While paid plans are switched off,
 * it says so first.
 */

function BillingOff({ who }: { who: string }) {
  return (
    <Alert tone="ok" title={`Right now, everything is included for ${who} — at no cost`}>
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
  const results = await Promise.allSettled([
    pricing('user', 'web'),
    pricing('user', 'ios'),
    pricing('business', 'web'),
  ]);
  const [user, userIos, business] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  if (!user && !business) {
    const failure = results.find((r) => r.status === 'rejected')?.reason as unknown;
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

  const plus = user?.plans.find((p) => !p.free);
  const iosPlus = userIos?.plans.find((p) => p.code === plus?.code)?.prices[0];
  const webPlus = plus?.prices[0];

  return (
    <Container className="flex flex-col gap-16 py-10 sm:py-14">
      <PageHeading
        eyebrow="Pricing"
        title="Simple plans, no surprises"
        description="Appointments are always paid at the business, never through BUKU. These plans are only for using BUKU itself."
      />

      {user && (
        <section
          id="customers"
          aria-labelledby="customers-title"
          className="flex scroll-mt-24 flex-col gap-6"
        >
          <h2 id="customers-title" className="font-display text-3xl font-bold tracking-tight">
            For people booking and queueing
          </h2>
          {!user.billingEnabled && <BillingOff who="everyone" />}
          <ul className="grid gap-4 md:grid-cols-2">
            {user.plans.map((p) => (
              <li key={p.code}>
                <PlanCard plan={p} trial={user.trial} highlight={!p.free} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 text-sm text-ink-3">
            {user.trial && (
              <p>
                Try {user.trial.plan.name} free for {user.trial.days} days — once per account, whenever you
                like.
              </p>
            )}
            {webPlus && iosPlus && iosPlus.amount !== webPlus.amount && (
              <p>
                {plus.name} is {money(webPlus.amount, webPlus.currency)} a month on the website and Android;
                in the iPhone app it’s {money(iosPlus.amount, iosPlus.currency)}, the App Store price.
              </p>
            )}
            {taxNote(user) && <p>{taxNote(user)}</p>}
          </div>
        </section>
      )}

      {business && (
        <section
          id="businesses"
          aria-labelledby="businesses-title"
          className="flex scroll-mt-24 flex-col gap-6"
        >
          <h2 id="businesses-title" className="font-display text-3xl font-bold tracking-tight">
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
                Try {business.trial.plan.name} free for {business.trial.days} days — once per business.
              </p>
            )}
            {taxNote(business) && <p>{taxNote(business)}</p>}
          </div>
        </section>
      )}

      <section aria-labelledby="questions" className="flex flex-col gap-3">
        <h2 id="questions" className="font-display text-2xl font-semibold">
          Good to know
        </h2>
        <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5 text-ink-2">
          <li>Cancel any time; you keep your plan until the end of the period you paid for.</li>
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

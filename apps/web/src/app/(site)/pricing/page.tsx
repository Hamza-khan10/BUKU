import { CalendarCheck, Check, Ticket } from 'lucide-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Container, PageHeading } from '@/components/ui/layout';
import { BRANCHES } from '@/features/early-access/schema';
import { faqStructuredData, PRICING_QUESTIONS } from '@/features/marketing/faq';
import { LaunchPricing } from '@/features/pricing/components/launch-pricing';
import { PlanComparison } from '@/features/pricing/components/plan-comparison';
import {
  CURRENCIES,
  currencyFor,
  ENTERPRISE,
  enterpriseBranchAnswer,
  MONTHS_PER_YEAR_PAID,
  type Currency,
} from '@/features/pricing/launch-plans';
import { prelaunch } from '@/lib/flags';
import { brandGraph } from '@/lib/brand';
import { jsonLd, pageMetadata } from '@/lib/seo';
import { siteFacts } from '@/lib/site';
import { siteUrl } from '@/lib/site-url';

export const metadata = pageMetadata({
  title: 'Pricing',
  description:
    'Booking and queueing are free for everyone. Businesses start free with Starter; Essential, Professional and Network grow with the team, in rupees in Pakistan and dollars elsewhere.',
  path: '/pricing',
});

/**
 * Pricing (D-137): free for people who book (D-101); for businesses, the plans at launch, priced in
 * rupees in Pakistan and dollars elsewhere, per branch. The plans live in the website itself
 * (features/pricing/launch-plans.ts), so the page stands without the API, as the site does before
 * launch.
 */
export default async function PricingPage({ searchParams }: PageProps<'/pricing'>) {
  const [query, incoming] = await Promise.all([searchParams, headers()]);
  const asked = typeof query.currency === 'string' ? query.currency.toUpperCase() : '';
  const currency: Currency = (CURRENCIES as readonly string[]).includes(asked)
    ? (asked as Currency)
    : currencyFor(incoming.get('cf-ipcountry') ?? incoming.get('x-vercel-ip-country'));
  const early = prelaunch();
  const facts = siteFacts();
  const nonce = incoming.get('x-nonce') ?? undefined;

  return (
    <Container className="flex flex-col gap-20 py-10 sm:gap-28 sm:py-14">
      <section
        id="businesses"
        aria-labelledby="businesses-title"
        className="flex scroll-mt-24 flex-col gap-10"
      >
        <PageHeading
          eyebrow="Pricing"
          title="Free to start. Simple as you grow."
          description={
            <>
              Start with Starter at no cost, and try Professional free for 30 days. Every price is per branch.{' '}
              {early &&
                'BUKU opens soon: these are the prices at launch, and nothing is charged before then.'}
            </>
          }
        />
        <h2 id="businesses-title" className="sr-only">
          Plans for businesses
        </h2>
        <LaunchPricing initialCurrency={currency} early={early} />

        {/* Enterprise (3.7i): the one plan you ask for, so the ask is easy to find. On Midnight
            like the board, with the way in up front: before launch, the business list with
            Enterprise and 10 to 20 branches already chosen (D-145); and a direct address. */}
        <aside
          aria-labelledby="enterprise-title"
          data-tone="dark"
          className="scope-dark relative isolate overflow-hidden rounded-[1.75rem] bg-board p-7 text-board-ink sm:p-10 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-14"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -top-40 -right-24 -z-10 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgb(6_127_93/0.45),transparent)]"
          />
          <div className="flex flex-col gap-5">
            <p className="text-sm font-semibold tracking-[0.08em] text-board-go uppercase">Enterprise</p>
            <h3
              id="enterprise-title"
              className="text-[2rem] leading-[1.05] font-semibold tracking-[-0.04em] sm:text-[2.6rem]"
            >
              {ENTERPRISE.fromBranches} branches or more?{' '}
              <span className="text-board-ink-2">We’ll plan it with you.</span>
            </h3>
            <p className="max-w-[44ch] text-board-ink-2">
              One price for every branch, made together, and someone at BUKU who knows your business.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1">
              <Button asChild variant="primary" size="lg">
                <Link
                  href={
                    early
                      ? `/early-access?as=business&plan=enterprise&branches=${enterpriseBranchAnswer(BRANCHES) ?? ''}&source=pricing-enterprise`
                      : '/contact'
                  }
                >
                  Talk to us
                </Link>
              </Button>
              {facts.email.business && (
                <a
                  href={`mailto:${facts.email.business}?subject=BUKU%20Enterprise`}
                  className="text-board-ink-2 underline underline-offset-4 transition-colors hover:text-board-ink"
                >
                  or email {facts.email.business}
                </a>
              )}
            </div>
          </div>
          <ul className="mt-8 flex flex-col gap-3 lg:mt-0">
            {ENTERPRISE.includes.map((line) => (
              <li
                key={line}
                className="flex items-start gap-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-board-go-fill text-board-on-go">
                  <Check aria-hidden className="size-4" strokeWidth={2.6} />
                </span>
                <span className="pt-0.5">{line}</span>
              </li>
            ))}
          </ul>
        </aside>

        <p className="text-sm text-ink-3">
          Prices are per branch, before tax. A year costs {MONTHS_PER_YEAR_PAID} months. Booking with BUKU is
          never charged to the business or the customer.
        </p>
      </section>

      <section aria-labelledby="compare-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 id="compare-title" className="type-section">
            Every plan, side by side.
          </h2>
          <p className="text-sm text-ink-2 sm:hidden">Swipe the table to see every plan.</p>
        </div>
        <PlanComparison />
      </section>

      <section
        id="customers"
        aria-labelledby="customers-title"
        className="flex scroll-mt-24 flex-col gap-6 rounded-xl bg-brand-soft p-6 sm:p-10"
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
        aria-labelledby="questions"
        className="reveal-rise grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20"
      >
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLd(faqStructuredData(PRICING_QUESTIONS)) }}
        />
        {/* BUKU and its prices, for answer engines asked what it costs (D-138). */}
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: jsonLd({ '@context': 'https://schema.org', '@graph': brandGraph(siteUrl()) }),
          }}
        />
        <div className="flex flex-col gap-5 lg:sticky lg:top-28 lg:self-start">
          <h2 id="questions" className="type-section">
            Questions about pricing.
          </h2>
          <p className="text-ink-2">
            Something we haven’t answered?{' '}
            <Link href="/contact" className="font-medium text-brand-ink underline underline-offset-4">
              Write to us
            </Link>
            .
          </p>
        </div>
        <Accordion type="single" collapsible defaultValue={`price-${PRICING_QUESTIONS[0]!.id}`}>
          {PRICING_QUESTIONS.map((item) => (
            <AccordionItem key={item.id} value={`price-${item.id}`} question={item.q}>
              <p>{item.a}</p>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </Container>
  );
}

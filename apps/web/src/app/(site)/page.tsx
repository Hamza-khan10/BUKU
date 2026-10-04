import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  LockKeyhole,
  MessageSquareQuote,
  Ticket as TicketIcon,
  Wallet,
} from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Container } from '@/components/ui/layout';
import { Ticket } from '@/components/ui/ticket';
import { CategoryIcon } from '@/features/categories/icons';
import { categoryTree, cities, shelf } from '@/features/search/api';
import { BusinessGrid } from '@/features/search/components/business-card';
import { SearchBox } from '@/features/search/components/search-box';
import type { CategoryNode, City, SearchItem } from '@/features/search/types';
import { cn } from '@/lib/cn';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/**
 * The home page: what BUKU is, then real places to go to — open now,
 * popular this week, top rated — in a city people can switch. Every number
 * and every place comes from the API; a shelf with nothing true to show is
 * simply left out.
 */

const PROMISES = [
  {
    Icon: MessageSquareQuote,
    title: 'Reviews only from real visits',
    text: 'Only someone whose visit was completed can review it — once.',
  },
  {
    Icon: BadgeCheck,
    title: '“Verified” means checked',
    text: 'BUKU reviews a business’s legal details and documents before it says so.',
  },
  {
    Icon: LockKeyhole,
    title: 'Your number stays yours',
    text: 'Businesses see your name and booking — never your phone, email or picture.',
  },
  {
    Icon: Wallet,
    title: 'Pay at the venue',
    text: 'You pay the business as you always have. BUKU never takes payment for a visit.',
  },
];

function Shelf({ id, title, items, more }: { id: string; title: string; items: SearchItem[]; more: Route }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <h2 id={id} className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <Link
          href={more}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline"
        >
          See all <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <BusinessGrid items={items} label={title} />
    </section>
  );
}

function CityPicker({ list, current }: { list: City[]; current: string }) {
  if (list.length < 2) return null;
  return (
    <nav aria-label="Choose a city" className="flex flex-wrap gap-2">
      {list.slice(0, 8).map((c) => {
        const on = c.city.toLowerCase() === current.toLowerCase();
        return (
          <Link
            key={`${c.city}-${c.country}`}
            href={`/?city=${encodeURIComponent(c.city)}` as Route}
            scroll={false}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors',
              on ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface text-ink-2 hover:text-ink',
            )}
          >
            {c.city}
          </Link>
        );
      })}
    </nav>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink tabular">
        {n}
      </span>
      <span className="text-ink-2">{children}</span>
    </li>
  );
}

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  const asked = (await searchParams).city;
  const [cityList, tree] = await Promise.all([
    cities().catch(() => []),
    categoryTree().catch(() => [] as CategoryNode[]),
  ]);
  const chosen =
    cityList.find((c) => typeof asked === 'string' && c.city.toLowerCase() === asked.toLowerCase()) ??
    cityList[0];
  const city = chosen?.city ?? '';
  const places = cityList.reduce((n, c) => n + c.businesses, 0);
  const cityQuery = city ? `city=${encodeURIComponent(city)}` : '';

  const [openNow, trending, topRated, featured] = city
    ? await Promise.all([
        shelf({ city, openNow: true, limit: 6 }),
        shelf({ city, limit: 6 }, '/v1/businesses/trending'),
        shelf({ city, sort: 'rating', minRating: 4, limit: 6 }),
        shelf({ city, limit: 6 }, '/v1/businesses/featured'),
      ])
    : [[], [], [], []];
  const nothingYet = city && [openNow, trending, topRated, featured].every((s) => s.length === 0);

  return (
    <div className="flex flex-col gap-20 pb-8 sm:gap-24">
      {/* ── The pitch ── */}
      <section className="relative overflow-hidden border-b border-line bg-[radial-gradient(ellipse_at_top_right,color-mix(in_srgb,var(--brand)_10%,transparent),transparent_55%)]">
        <Container className="grid grid-cols-1 items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6 animate-rise">
            <p className="text-sm font-semibold tracking-wide text-brand-ink uppercase">
              Appointments and queues
            </p>
            <h1 className="font-display text-5xl leading-[1.02] font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Know exactly when. <span className="text-brand-ink">It’s handled.</span>
            </h1>
            <p className="max-w-xl text-lg text-ink-2 sm:text-xl">
              Book a time at local businesses, or join their queue from nearby and watch your place in line
              move — no calling around, no standing and wondering.
            </p>
            <div className="max-w-xl">
              <SearchBox city={city || undefined} />
            </div>
            {tree.length > 0 && (
              <ul aria-label="Popular categories" className="flex flex-wrap gap-2">
                {tree.slice(0, 6).map((c) => (
                  <li key={c.slug}>
                    <Link
                      href={`/c/${c.slug}` as Route}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
                    >
                      <CategoryIcon slug={c.slug} className="size-4" />
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {places > 0 && (
              <p className="text-sm text-ink-3">
                {places} {places === 1 ? 'place' : 'places'} in {cityList.length}{' '}
                {cityList.length === 1 ? 'city' : 'cities'} on BUKU so far.
              </p>
            )}
          </div>
          <figure className="hidden flex-col items-center gap-3 lg:flex">
            <div className="relative w-full max-w-md">
              <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-wait-soft/60 blur-2xl" />
              <Ticket
                fresh
                qr
                title="Haircut with Ali"
                place="Example Barbers"
                when="Thu · 10:30–11:00"
                details={<span>Pay at the venue</span>}
                code="BK-7KQ2MX"
                codeLabel="Booking code"
                status={{ label: 'Confirmed', tone: 'ok' }}
              />
            </div>
            <figcaption className="text-sm text-ink-3">Example: what your booking looks like</figcaption>
          </figure>
        </Container>
      </section>

      {/* ── Real places, in a city you choose ── */}
      {city && (
        <Container className="flex flex-col gap-12">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Places in {city}</h2>
            <CityPicker list={cityList} current={city} />
          </div>
          <Shelf
            id="open-now"
            title="Open now"
            items={openNow}
            more={`/explore?${cityQuery}&openNow=1` as Route}
          />
          <Shelf
            id="trending"
            title="Popular this week"
            items={trending}
            more={`/explore?${cityQuery}` as Route}
          />
          <Shelf
            id="top-rated"
            title="Top rated"
            items={topRated}
            more={`/explore?${cityQuery}&sort=rating&topRated=1` as Route}
          />
          <Shelf
            id="featured"
            title="Verified, with photos"
            items={featured}
            more={`/explore?${cityQuery}&verifiedOnly=1` as Route}
          />
          {nothingYet && (
            <p className="text-ink-2">
              Nothing to show in {city} right now.{' '}
              <Link
                href={`/explore?${cityQuery}` as Route}
                className="font-medium text-brand-ink underline underline-offset-4"
              >
                See every place in {city}
              </Link>
              .
            </p>
          )}
        </Container>
      )}

      {/* ── Every kind of place ── */}
      {tree.length > 0 && (
        <Container>
          <section aria-labelledby="categories" className="flex flex-col gap-6">
            <div className="flex items-end justify-between gap-4">
              <h2 id="categories" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Every kind of place
              </h2>
              <Link
                href="/categories"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-ink hover:underline"
              >
                All categories <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {tree.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/c/${c.slug}` as Route}
                    className="group flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-soft transition-shadow hover:shadow-lift"
                  >
                    <span className="grid size-11 place-items-center rounded-md bg-brand-soft text-brand-ink transition-transform group-hover:scale-105">
                      <CategoryIcon slug={c.slug} className="size-5" />
                    </span>
                    <span className="font-medium text-ink">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </Container>
      )}

      {/* ── Two ways to stop waiting ── */}
      <Container>
        <section aria-labelledby="how" className="flex flex-col gap-6">
          <h2 id="how" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Two ways to stop waiting
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-soft">
              <span className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-md bg-ok-soft text-ok">
                  <CalendarCheck className="size-5" aria-hidden />
                </span>
                <h3 className="font-display text-xl font-semibold">Book a time</h3>
              </span>
              <ol className="flex flex-col gap-3">
                <Step n={1}>Pick a service and one of the business’s real free times.</Step>
                <Step n={2}>Get a ticket with a code — and reminders before you go.</Step>
                <Step n={3}>Show the code at the front desk. Review your visit after.</Step>
              </ol>
            </div>
            <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-soft">
              <span className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-md bg-wait-soft text-wait-ink">
                  <TicketIcon className="size-5" aria-hidden />
                </span>
                <h3 className="font-display text-xl font-semibold">Join the queue</h3>
              </span>
              <ol className="flex flex-col gap-3">
                <Step n={1}>Take a ticket from nearby, before you arrive.</Step>
                <Step n={2}>Watch how many are ahead of you, live.</Step>
                <Step n={3}>Get a nudge when you’re close, and come in when called.</Step>
              </ol>
            </div>
          </div>
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
          >
            How it works, step by step <ArrowRight className="size-4" aria-hidden />
          </Link>
        </section>
      </Container>

      {/* ── What we promise ── */}
      <Container>
        <section aria-labelledby="promises" className="rounded-2xl bg-night p-8 text-[#f6f2ec] sm:p-12">
          <h2 id="promises" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            What you can count on
          </h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map(({ Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-3">
                <Icon className="size-6 text-[#ff8c73]" aria-hidden />
                <h3 className="font-display text-lg font-semibold">{title}</h3>
                <p className="text-[#c5cbd6]">{text}</p>
              </li>
            ))}
          </ul>
        </section>
      </Container>
    </div>
  );
}

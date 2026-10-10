import { BadgeCheck, LockKeyhole, MessageSquareQuote, Wallet } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout';
import { CategoryIcon } from '@/features/categories/icons';
import { HowItGoes } from '@/features/home/components/how-it-goes';
import { PlacesRail } from '@/features/home/components/places-rail';
import { QueueBoard } from '@/features/home/components/queue-board';
import { categoryTree, cities, shelf } from '@/features/search/api';
import { SearchBox } from '@/features/search/components/search-box';
import type { CategoryNode, City } from '@/features/search/types';
import { cn } from '@/lib/cn';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/**
 * The home page (WEB_PLAN §2, D-093): what BUKU is in one line and one
 * picture (the queue board), then real places in a city people can switch,
 * how a visit goes, every kind of place, and what BUKU promises. Every place
 * and every number comes from the API; a list with nothing true to show is
 * left out.
 */

const PROMISES = [
  {
    Icon: MessageSquareQuote,
    title: 'Reviews only from real visits',
    text: 'Only someone whose visit was completed can review it, and only once.',
  },
  {
    Icon: BadgeCheck,
    title: 'Verified means checked',
    text: 'BUKU checks a business’s legal details and documents before calling it verified.',
  },
  {
    Icon: LockKeyhole,
    title: 'Your number stays yours',
    text: 'Businesses see your name and your booking. Never your phone, email or picture.',
  },
  {
    Icon: Wallet,
    title: 'Pay at the venue',
    text: 'You pay the business as you always have. BUKU never takes payment for a visit.',
  },
];

function CityPicker({ list, current }: { list: City[]; current: string }) {
  if (list.length < 2) return null;
  return (
    <nav
      aria-label="Choose a city"
      className="inline-flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-sunken p-1"
    >
      {list.slice(0, 8).map((c) => {
        const on = c.city.toLowerCase() === current.toLowerCase();
        return (
          <Link
            key={`${c.city}-${c.country}`}
            href={`/?city=${encodeURIComponent(c.city)}` as Route}
            scroll={false}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'inline-flex h-9 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-200',
              on ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink',
            )}
          >
            {c.city}
          </Link>
        );
      })}
    </nav>
  );
}

const sectionTitle = 'text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[3rem]';

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

  const [openNow, trending, topRated] = city
    ? await Promise.all([
        shelf({ city, openNow: true, limit: 6 }),
        shelf({ city, limit: 6 }, '/v1/businesses/trending'),
        shelf({ city, sort: 'rating', minRating: 4, limit: 6 }),
      ])
    : [[], [], []];
  const nothingYet = city && [openNow, trending, topRated].every((s) => s.length === 0);

  return (
    <div className="flex flex-col gap-28 pb-8 sm:gap-36">
      {/* ── What BUKU is ── */}
      <Container className="grid grid-cols-1 items-center gap-14 pt-12 sm:pt-20 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pt-0">
        <div className="flex flex-col gap-7">
          <h1 className="text-[3.25rem] leading-[0.98] font-semibold tracking-[-0.045em] sm:text-[4.5rem] xl:text-[5.25rem]">
            Know exactly when.
          </h1>
          <p className="max-w-[34rem] text-xl leading-relaxed text-ink-2 sm:text-[1.35rem]">
            Book a time at local businesses, or join their queue from home and come in when you’re called.
          </p>
          <div className="max-w-xl pt-1">
            <SearchBox city={city || undefined} />
          </div>
        </div>
        <QueueBoard className="mx-auto w-full max-w-[30rem] lg:mr-0" />
      </Container>

      {/* ── Real places, in a city you choose ── */}
      {city && (
        <Container className="flex flex-col gap-10">
          <div className="flex flex-col gap-5">
            <h2 className={sectionTitle}>Places in {city}</h2>
            {places > 0 && (
              <p className="text-lg text-ink-2">
                {places} {places === 1 ? 'place' : 'places'} in {cityList.length}{' '}
                {cityList.length === 1 ? 'city' : 'cities'} on BUKU so far.
              </p>
            )}
            <CityPicker list={cityList} current={city} />
          </div>
          <PlacesRail
            shelves={[
              {
                id: 'open-now',
                label: 'Open now',
                moreLabel: `All places open now in ${city}`,
                items: openNow,
                more: `/explore?${cityQuery}&openNow=1` as Route,
              },
              {
                id: 'trending',
                label: 'Popular this week',
                moreLabel: `Every place in ${city}`,
                items: trending,
                more: `/explore?${cityQuery}` as Route,
              },
              {
                id: 'top-rated',
                label: 'Top rated',
                moreLabel: `Top-rated places in ${city}`,
                items: topRated,
                more: `/explore?${cityQuery}&sort=rating` as Route,
              },
            ]}
          />
          {nothingYet && (
            <p className="text-ink-2">
              No places to show in {city} right now.{' '}
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

      {/* ── How a visit goes ── */}
      <Container>
        <HowItGoes />
      </Container>

      {/* ── Every kind of place ── */}
      {tree.length > 0 && (
        <Container>
          <section aria-labelledby="categories" className="flex flex-col gap-10">
            <div className="flex flex-col gap-4">
              <h2 id="categories" className={sectionTitle}>
                Every kind of place.
              </h2>
              <p className="max-w-2xl text-lg leading-relaxed text-ink-2">
                Barbers and clinics, government offices and garages. If you’d normally wait there, it can be
                on BUKU.
              </p>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {tree.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/c/${c.slug}` as Route}
                    className="group flex h-full flex-col justify-between gap-10 rounded-xl bg-sunken p-5 transition-[background-color,transform] duration-300 ease-(--ease-out) hover:bg-line/70 active:scale-[0.98] sm:p-6"
                  >
                    <CategoryIcon
                      slug={c.slug}
                      className="size-7 text-ink-2 transition-colors duration-300 group-hover:text-brand-ink"
                    />
                    <span className="text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/categories"
              className="self-start font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              All categories and what’s in them
            </Link>
          </section>
        </Container>
      )}

      {/* ── What we promise ── */}
      <Container>
        <section aria-labelledby="promises" className="flex flex-col gap-12">
          <h2 id="promises" className={cn(sectionTitle, 'max-w-2xl')}>
            What you can count on.
          </h2>
          <ul className="grid gap-x-12 gap-y-12 border-t border-line pt-12 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map(({ Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-3">
                <Icon className="size-6 text-brand-ink" aria-hidden />
                <h3 className="mt-2 text-lg font-semibold tracking-[-0.015em]">{title}</h3>
                <p className="leading-relaxed text-ink-2">{text}</p>
              </li>
            ))}
          </ul>
        </section>
      </Container>

      {/* ── For businesses ── */}
      <Container>
        <section
          aria-labelledby="for-business"
          className="flex flex-col items-start gap-8 rounded-2xl border border-line bg-surface p-8 shadow-soft sm:p-12 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="flex max-w-xl flex-col gap-4">
            <h2
              id="for-business"
              className="text-[2rem] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[2.5rem]"
            >
              Run a business? Give people a time, not a wait.
            </h2>
            <p className="text-lg leading-relaxed text-ink-2">
              Your calendar and your walk-in queue in one place, with reminders sent before every visit.
            </p>
          </div>
          <Button asChild variant="primary" size="lg">
            <Link href="/for-business">BUKU for businesses</Link>
          </Button>
        </section>
      </Container>
    </div>
  );
}

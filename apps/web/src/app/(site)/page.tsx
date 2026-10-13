import { BadgeCheck, LockKeyhole, MessageSquareQuote, Wallet } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Container, SectionHeading } from '@/components/ui/layout';
import { CategoryIcon } from '@/features/categories/icons';
import { PlacesRail } from '@/features/home/components/places-rail';
import { BoardGlow } from '@/components/motion/board';
import { CountUp } from '@/components/motion/count-up';
import { Magnetic } from '@/components/motion/magnetic';
import { RiseWords } from '@/components/motion/rise-words';
import { ScrollMarquee } from '@/components/motion/scroll-marquee';
import { ScrollStory } from '@/features/home/components/scroll-story';
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
    <div className="flex flex-col gap-20 pb-8 sm:gap-36">
      {/* ── What BUKU is ── */}
      <Container className="grid grid-cols-1 items-center gap-9 pt-7 sm:gap-14 sm:pt-16 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pt-0">
        <div className="flex flex-col gap-5 sm:gap-7">
          <h1 className="text-[3.1rem] leading-[1] font-semibold tracking-[-0.045em] sm:text-[4.5rem] xl:text-[5.25rem]">
            <RiseWords text="Book the time." /> <RiseWords text="Skip the wait." from={3} />
          </h1>
          <p className="rise-in max-w-[34rem] text-lg leading-relaxed text-ink-2 sm:text-[1.35rem]">
            Appointments and walk-in queues at barbers, clinics, salons and offices near you, all from your
            phone.
          </p>
          <div className="rise-in max-w-xl [--i:2] sm:pt-1">
            <SearchBox city={city || undefined} />
          </div>
        </div>
        <BoardGlow>
          <QueueBoard className="w-full" />
        </BoardGlow>
      </Container>

      {/* ── Every kind of place BUKU lists, moving with the scroll ── */}
      {tree.length > 0 && (
        <ScrollMarquee
          items={tree.flatMap((g) => g.children.map((c) => c.name)).slice(0, 18)}
          className="-my-6 text-[2.4rem] leading-none font-semibold tracking-[-0.04em] text-control sm:-my-10 sm:text-[4.5rem]"
        />
      )}

      {/* ── Real places, in a city you choose ── */}
      {city && (
        <Container className="flex flex-col gap-10">
          <div className="flex flex-col gap-5">
            <SectionHeading
              eyebrow="Near you"
              title={`Places in ${city}`}
              description={
                places > 0 ? (
                  <>
                    <CountUp value={places} /> {places === 1 ? 'place' : 'places'} in{' '}
                    <CountUp value={cityList.length} /> {cityList.length === 1 ? 'city' : 'cities'} on BUKU so
                    far.
                  </>
                ) : undefined
              }
            />
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

      {/* ── How a visit goes: told on a phone as you scroll ── */}
      <ScrollStory />

      {/* ── Every kind of place ── */}
      {tree.length > 0 && (
        <Container>
          <section aria-labelledby="categories" className="flex flex-col gap-10">
            <SectionHeading
              id="categories"
              eyebrow="Categories"
              title="Every kind of place."
              description="Barbers and clinics, government offices and garages. If you’d normally wait there, it can be on BUKU."
            />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {tree.map((c, i) => (
                <li key={c.slug} className="reveal" style={{ '--i': i % 4 } as CSSProperties}>
                  <Link
                    href={`/c/${c.slug}` as Route}
                    className="group flex h-full flex-col justify-between gap-7 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line transition-[box-shadow,transform] duration-300 ease-(--ease-out) hover:ring-control active:scale-[0.98] sm:gap-10 sm:p-6"
                  >
                    <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand-ink transition-transform duration-300 ease-(--ease-out) group-hover:scale-110">
                      <CategoryIcon slug={c.slug} className="size-5" />
                    </span>
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
          <SectionHeading id="promises" eyebrow="Our promise" title="What you can count on." />
          <ul className="grid gap-x-12 gap-y-12 border-t border-line pt-12 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map(({ Icon, title, text }, i) => (
              <li key={title} className="reveal flex flex-col gap-3" style={{ '--i': i } as CSSProperties}>
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
          className="reveal flex flex-col items-start gap-8 rounded-2xl bg-brand-soft p-6 sm:p-12 lg:flex-row lg:items-end lg:justify-between"
        >
          <SectionHeading
            id="for-business"
            eyebrow="For businesses"
            title="Run a business? Give people a time, not a wait."
            description="Your calendar and your walk-in queue in one place, with reminders sent before every visit."
            className="max-w-xl"
          />
          <Magnetic>
            <Button asChild variant="primary" size="lg">
              <Link href="/for-business">BUKU for businesses</Link>
            </Button>
          </Magnetic>
        </section>
      </Container>
    </div>
  );
}

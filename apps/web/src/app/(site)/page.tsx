import { ArrowRight, BadgeCheck, LockKeyhole, MessageSquareQuote, Wallet } from 'lucide-react';
import type { Route } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Container, SectionHeading } from '@/components/ui/layout';
import { CategoryFinder } from '@/features/categories/components/category-finder';
import { CategoryIcon } from '@/features/categories/icons';
import { PlacesRail, type Shelf } from '@/features/home/components/places-rail';
import { SignedInHome } from '@/features/home/components/signed-in/signed-in-home';
import { BoardGlow } from '@/components/motion/board';
import { CountUp } from '@/components/motion/count-up';
import { Magnetic } from '@/components/motion/magnetic';
import { HeldDot } from '@/components/brand/held-dot';
import { RiseWords } from '@/components/motion/rise-words';
import { ScrollMarquee } from '@/components/motion/scroll-marquee';
import { ScrollStory } from '@/features/home/components/scroll-story';
import { QueueBoard } from '@/features/home/components/queue-board';
import { CATEGORY_SNAPSHOT } from '@/features/categories/snapshot';
import { categoryTree, cities, shelf } from '@/features/search/api';
import { CityPicker } from '@/features/home/components/city-picker';
import { SearchBox } from '@/features/search/components/search-box';
import type { CategoryNode } from '@/features/search/types';
import { apiConfigured, prelaunch } from '@/lib/flags';
import { jsonLd, pageMetadata } from '@/lib/seo';
import { brandGraph } from '@/lib/brand';
import { signedInHere } from '@/lib/session/server';
import { siteUrl } from '@/lib/site-url';

export const metadata = pageMetadata({
  // What BUKU is, in the words people search with, so it isn't taken for the other "BUKU"s (D-138).
  title: 'BUKU: book appointments and join walk-in queues online',
  description:
    'Book appointments and join walk-in queues at barbers, clinics, salons and offices near you, free. Businesses run their bookings and queue with BUKU.',
  path: '/',
  absoluteTitle: true,
});

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

/** Up to `n` kinds of place (the first of each group, then the second…), for a row of quick picks. */
function kindsAcross(tree: CategoryNode[], n: number): CategoryNode[] {
  const kinds: CategoryNode[] = [];
  for (let i = 0; kinds.length < n && tree.some((g) => i < g.children.length); i++) {
    for (const g of tree) if (i < g.children.length && kinds.length < n) kinds.push(g.children[i]!);
  }
  return kinds;
}

/** Up to `n` kinds of place, taken a few from every group in turn, so one big group doesn't fill the line. */
function acrossGroups(tree: CategoryNode[], n: number): string[] {
  const names: string[] = [];
  for (let i = 0; names.length < n && tree.some((g) => i < g.children.length); i++) {
    for (const g of tree) if (i < g.children.length && names.length < n) names.push(g.children[i]!.name);
  }
  return names;
}

/** BUKU as an organisation, its website and its app (schema.org), at the site's one address. */
function siteStructuredData() {
  return { '@context': 'https://schema.org', '@graph': brandGraph(siteUrl()) };
}

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  const [query, incoming] = await Promise.all([searchParams, headers()]);
  const asked = query.city;
  const [cityList, tree] = await Promise.all([
    cities().catch(() => []),
    // Without the API (before launch) the kinds BUKU starts with, so home links every category.
    apiConfigured() ? categoryTree().catch(() => CATEGORY_SNAPSHOT) : Promise.resolve(CATEGORY_SNAPSHOT),
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
  const shelves: Shelf[] = [
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
  ];

  // Signed in, home is theirs: not the page that explains BUKU to a first-time visitor.
  if (!prelaunch() && (await signedInHere())) {
    return <SignedInHome city={city} cityList={cityList} kinds={kindsAcross(tree, 8)} shelves={shelves} />;
  }

  return (
    <div className="flex flex-col gap-20 pb-8 sm:gap-36">
      {/* Who runs this site and what it is, for search and answer engines (D-136). */}
      <script
        type="application/ld+json"
        nonce={incoming.get('x-nonce') ?? undefined}
        dangerouslySetInnerHTML={{ __html: jsonLd(siteStructuredData()) }}
      />
      {/* ── What BUKU is ── */}
      <Container className="grid grid-cols-1 items-center gap-9 pt-7 sm:gap-14 sm:pt-16 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pt-0">
        <div className="flex flex-col gap-5 sm:gap-7">
          {/* Two lines, each fitting its column (measured: "wait to be seen." is 498 px at 76 px). */}
          <h1 className="text-[3.1rem] leading-[1] font-semibold tracking-[-0.045em] sm:text-[4.25rem] xl:text-[4.75rem]">
            <span className="block">
              <RiseWords text="No one should" />
            </span>{' '}
            <span className="block">
              <RiseWords text="wait to be seen" from={3} />
              <HeldDot after={7} />
            </span>
          </h1>
          <p className="rise-in max-w-[34rem] text-lg leading-relaxed text-ink-2 sm:text-[1.35rem]">
            Book a time or take a number from your phone, at barbers, clinics, salons and offices near you.
          </p>
          {prelaunch() ? (
            // Before launch (D-134) there's nothing to search yet: the door is the early-access list.
            <div className="rise-in flex flex-wrap gap-3 [--i:2] sm:pt-1">
              <Button asChild variant="primary" size="lg">
                <Link href="/early-access?as=customer&source=home">Get early access</Link>
              </Button>
              <Button asChild size="lg">
                <Link href="/early-access?as=business&source=home">I run a business</Link>
              </Button>
            </div>
          ) : (
            <div className="rise-in max-w-xl [--i:2] sm:pt-1">
              <SearchBox city={city || undefined} />
            </div>
          )}
        </div>
        <BoardGlow>
          <QueueBoard
            className="w-full"
            cta={
              prelaunch()
                ? { href: '/early-access?as=customer&source=board', label: 'Get early access' }
                : { href: '/explore', label: 'Find a place' }
            }
          />
        </BoardGlow>
      </Container>

      {/* ── Every kind of place BUKU lists, moving with the scroll ── */}
      {tree.length > 0 && (
        <ScrollMarquee
          items={acrossGroups(tree, 18)}
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
          <PlacesRail shelves={shelves} />
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
            {/* Straight to any of the kinds by name (3.7i), the groups below for browsing. */}
            <CategoryFinder
              early={prelaunch()}
              label="Where do you wait?"
              groups={tree
                .filter((g) => g.children.length > 0)
                .map((g) => ({
                  slug: g.slug,
                  name: g.name,
                  kinds: g.children.map((k) => ({ slug: k.slug, name: k.name })),
                }))}
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
              {/* The way into every kind, as the last tile, so the grid ends on a full row. */}
              <li className="reveal" style={{ '--i': tree.length % 4 } as CSSProperties}>
                <Link
                  href="/categories"
                  className="group flex h-full flex-col justify-between gap-7 rounded-xl bg-brand-soft p-4 ring-1 ring-line transition-[box-shadow,transform] duration-300 ease-(--ease-out) hover:ring-control active:scale-[0.98] sm:gap-10 sm:p-6"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-surface text-brand-ink transition-transform duration-300 ease-(--ease-out) group-hover:translate-x-1">
                    <ArrowRight aria-hidden className="size-5" />
                  </span>
                  <span className="text-[1.05rem] font-semibold tracking-[-0.01em] text-brand-ink">
                    All {tree.reduce((n, g) => n + g.children.length, 0)} kinds of place
                  </span>
                </Link>
              </li>
            </ul>
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

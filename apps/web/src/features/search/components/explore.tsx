'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useLenis } from 'lenis/react';
import { ArrowUp, Compass, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/layout';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { CategoryIcon } from '@/features/categories/icons';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import {
  AUTO_PAGES,
  exploreHref,
  exploreKey,
  filtersFrom,
  nextPage,
  placesOf,
  type ExplorePage,
} from '../explore';
import { fetchExplorePage } from '../explore-api';
import { activeFilterCount, EMPTY_FILTERS, filtersQuery, type Filters } from '../params';
import type { CategoryNode, City } from '../types';
import { BusinessCard, BusinessCardSkeleton, BusinessGridSkeleton } from './business-card';
import { FilterChips } from './filters';
import { NearMe, PlaceControls } from './place-controls';
import { SearchBox } from './search-box';

/**
 * Explore (D-104): the search lives in the address, but changing it never reloads the page.
 * The first page comes rendered from the server (fast, and readable by search engines); then
 * every filter, city or category changes the results in place, showing their shape while they
 * load, and more places keep coming as you scroll (by themselves for the first pages, then with
 * "Show more", so the footer is never out of reach). Between pages, other kinds of place to
 * explore; at the end, where to look next.
 */
export function Explore({
  initial,
  initialFilters,
  cities,
  tree,
}: {
  /** The first page the server rendered, or the problem it had. */
  initial: ExplorePage | { error: string; requestId?: string | undefined };
  initialFilters: Filters;
  cities: City[];
  tree: CategoryNode[];
}) {
  const params = useSearchParams();
  const lenis = useLenis();
  const filters = useMemo(() => filtersFrom(params), [params]);
  // Smooth scrolling owns the page's scroll: going back up goes through it (or the browser's own).
  const toTop = useCallback(() => {
    if (lenis) lenis.scrollTo(0, { duration: 0.8 });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [lenis]);
  const navigate = useCallback(
    (f: Filters) => {
      window.history.pushState(null, '', exploreHref(f));
      toTop();
    },
    [toTop],
  );

  // The server's first page belongs to the search it rendered; any other search is fetched here.
  const sameSearch = filtersQuery({ ...filters, page: 1 }) === filtersQuery({ ...initialFilters, page: 1 });
  const serverPage = sameSearch && 'items' in initial ? initial : null;
  const results = useInfiniteQuery({
    queryKey: exploreKey(filters),
    queryFn: ({ pageParam, signal }) => fetchExplorePage(filters, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    ...(serverPage && { initialData: { pages: [serverPage], pageParams: [1] } }),
    staleTime: 60_000,
  });

  const places = useMemo(() => placesOf(results.data?.pages ?? []), [results.data]);
  const total = results.data?.pages[0]?.meta.total ?? 0;
  const pagesLoaded = results.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results;

  // More places as the end comes into view (the first few pages; then the button takes over).
  const sentinel = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || pagesLoaded >= AUTO_PAGES) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '900px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, pagesLoaded]);

  const groups = tree.filter((g) => g.children.length > 0);
  const kind = groups.flatMap((g) => [g, ...g.children]).find((c) => c.slug === filters.category);
  const group = groups.find(
    (g) => g.slug === filters.category || g.children.some((c) => c.slug === filters.category),
  );
  const filtered = activeFilterCount(filters) > 0;
  const serverError = sameSearch && 'error' in initial ? initial : null;

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <div className="relative">
        {/* A soft light behind the search: the page's welcome, not a box. It stays inside the page
            and has faded out before either edge, so the page never scrolls sideways. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-24 h-[28rem] bg-[radial-gradient(50%_70%_at_35%_25%,var(--brand-soft),transparent_70%)] opacity-80"
        />
        <PageHeading
          className="relative"
          eyebrow={filters.city ? `In ${filters.city}` : 'Every city on BUKU'}
          title={filters.q ? `Results for “${filters.q}”` : kind ? kind.name : 'Explore'}
        >
          <div className="max-w-2xl">
            <SearchBox key={filters.q} defaultValue={filters.q} city={filters.city || undefined} size="md" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PlaceControls base="/explore" filters={filters} cities={cities} onFilters={navigate} compact />
            <NearMe filters={filters} />
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-line sm:block" />
            <FilterChips
              base="/explore"
              filters={filters}
              categoryName={kind && kind.slug !== group?.slug ? kind.name : undefined}
              onFilters={navigate}
              className="max-sm:basis-full"
            />
          </div>
          <CategoryRail
            groups={groups}
            current={group?.slug ?? ''}
            onPick={(slug) => navigate({ ...filters, category: slug })}
          />
        </PageHeading>
      </div>

      {serverError || (results.isError && places.length === 0) ? (
        <ErrorState
          title="Search isn’t answering right now"
          message="Please try again in a moment."
          reference={
            serverError?.requestId ??
            (results.error instanceof ApiError ? results.error.requestId : undefined)
          }
          action={<Button onClick={() => void results.refetch()}>Try again</Button>}
        />
      ) : results.isPending ? (
        <section aria-busy="true" aria-label="Loading places" className="flex flex-col gap-6">
          <p className="text-ink-2">Finding places…</p>
          <BusinessGridSkeleton count={6} />
        </section>
      ) : places.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filtered || filters.q ? 'No places match all of that' : 'No places listed here yet'}
          action={
            filtered || filters.q || filters.city ? (
              <Button variant="primary" onClick={() => navigate(EMPTY_FILTERS)}>
                Start a fresh search
              </Button>
            ) : undefined
          }
        >
          {filtered
            ? 'Try turning off a filter, or another city.'
            : filters.q
              ? 'Try fewer or different words: a service (“haircut”) or a kind of place (“dentist”).'
              : 'When businesses here join BUKU, they’ll appear on this page.'}
        </EmptyState>
      ) : (
        <section aria-labelledby="results" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 id="results" className="type-heading" aria-live="polite">
              {total} {total === 1 ? 'place' : 'places'}
              {filters.city && <span className="text-ink-3"> in {filters.city}</span>}
            </h2>
            {results.isFetching && !isFetchingNextPage && (
              <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                <Spinner className="size-4" /> Updating
              </span>
            )}
          </div>

          <ul
            aria-label="Places"
            className={cn(
              'grid gap-x-6 gap-y-6 transition-opacity duration-300 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-3',
              results.isFetching && !isFetchingNextPage && 'opacity-60',
            )}
          >
            {places.map((item, i) => (
              <Fragment key={item.id}>
                {i === 12 && !filters.category && !filters.q && (
                  <li className="sm:col-span-2 lg:col-span-3">
                    <MoreKinds groups={groups} onPick={(slug) => navigate({ ...filters, category: slug })} />
                  </li>
                )}
                <li className="reveal" style={{ '--i': i % 3 } as CSSProperties}>
                  <BusinessCard item={item} row />
                </li>
              </Fragment>
            ))}
            {isFetchingNextPage &&
              Array.from({ length: 3 }, (_, i) => (
                <li key={`loading-${i}`} aria-hidden>
                  <BusinessCardSkeleton row />
                </li>
              ))}
          </ul>

          <div ref={sentinel} aria-hidden />
          {/* Above the cards and clear of them: a card still rising in never covers these buttons. */}
          <div ref={bottom} className="relative z-10 flex flex-col gap-6 pt-4">
            <p className="sr-only" aria-live="polite">
              Showing {places.length} of {total} places.
            </p>
            {hasNextPage ? (
              <div className="flex justify-center">
                <Button onClick={() => void fetchNextPage()} loading={isFetchingNextPage}>
                  Show more places
                </Button>
              </div>
            ) : (
              <TheEnd
                count={places.length}
                filters={filters}
                onAllCities={() => navigate({ ...filters, city: '' })}
              />
            )}
          </div>
        </section>
      )}
      <BackToTop onClick={toTop} hideNear={bottom} />
    </div>
  );
}

/** The groups, one tap each: the quickest way to narrow the list down. */
function CategoryRail({
  groups,
  current,
  onPick,
}: {
  groups: CategoryNode[];
  current: string;
  onPick: (slug: string) => void;
}) {
  const pill =
    'relative inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium ring-1 transition-[background-color,color,box-shadow] duration-200 active:scale-[0.97]';
  return (
    <nav aria-label="Kinds of place">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {[{ slug: '', name: 'Everything' }, ...groups].map((g) => {
          const on = g.slug === current;
          return (
            <li key={g.slug || 'all'} className="shrink-0">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(g.slug)}
                className={cn(
                  pill,
                  on
                    ? 'bg-brand text-on-brand ring-brand'
                    : 'bg-surface text-ink ring-line hover:ring-control',
                )}
              >
                {g.slug ? (
                  <CategoryIcon slug={g.slug} className="size-4" />
                ) : (
                  <Compass aria-hidden className="size-4" />
                )}
                {g.name}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Between pages: other kinds of place, a few from each group, so browsing keeps going somewhere new. */
function MoreKinds({ groups, onPick }: { groups: CategoryNode[]; onPick: (slug: string) => void }) {
  const kinds: CategoryNode[] = [];
  for (let i = 0; kinds.length < 8 && groups.some((g) => i < g.children.length); i++) {
    for (const g of groups)
      if (i < g.children.length && kinds.length < 8) kinds.push(g.children[(i * 3 + 1) % g.children.length]!);
  }
  if (kinds.length === 0) return null;
  return (
    <section
      aria-labelledby="more-kinds"
      className="flex flex-col gap-4 rounded-2xl bg-brand-soft p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="more-kinds" className="type-subheading">
          Or try something else
        </h2>
        <Link
          href="/categories"
          className="text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          Every kind of place
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kinds.map((k) => (
          <li key={k.slug}>
            <button
              type="button"
              onClick={() => onPick(k.slug)}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-surface px-3 py-2 text-left text-[0.95rem] font-medium text-ink shadow-soft ring-1 ring-line transition-[box-shadow,transform] duration-200 hover:ring-control active:scale-[0.98]"
            >
              <CategoryIcon slug={k.slug} className="size-[1.125rem] shrink-0 text-brand-ink" />
              {k.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The bottom of the list: how many were shown, and where to look next. */
function TheEnd({
  count,
  filters,
  onAllCities,
}: {
  count: number;
  filters: Filters;
  onAllCities: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 border-t border-line pt-8 text-center">
      <p className="text-ink-2">
        {count === 1 ? 'That’s the one place' : `That’s all ${count} places`} for this search.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {filters.city && <Button onClick={onAllCities}>Look in every city</Button>}
        <Button asChild variant="ghost">
          <Link href={'/categories'}>Browse every kind of place</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Far down a long list: one tap back to the search. It steps aside while the list's own buttons
 * ("Show more", where to look next) are on screen, so it never covers them.
 */
function BackToTop({
  onClick,
  hideNear,
}: {
  onClick: () => void;
  hideNear: RefObject<HTMLDivElement | null>;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Measured on every scroll and resize: far enough down, and the list's own buttons not on screen.
    const update = () => {
      const end = hideNear.current?.getBoundingClientRect();
      const endOnScreen = end ? end.top < window.innerHeight && end.bottom > 0 : false;
      setShown(window.scrollY > 1400 && !endOnScreen);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [hideNear]);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'fixed right-4 bottom-5 z-30 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-canvas shadow-lift transition-[opacity,transform] duration-300 ease-(--ease-out) sm:right-6 sm:bottom-6',
        shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
    >
      <ArrowUp aria-hidden className="size-4" />
      Back to the search
    </button>
  );
}

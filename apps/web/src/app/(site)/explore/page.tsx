import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { categoryTree, cities, searchBusinesses } from '@/features/search/api';
import { BusinessGrid } from '@/features/search/components/business-card';
import { FilterChips, Pagination } from '@/features/search/components/filters';
import { NearMe, PlaceControls } from '@/features/search/components/place-controls';
import { SearchBox } from '@/features/search/components/search-box';
import { activeFilterCount, filtersQuery, parseFilters, withFilters } from '@/features/search/params';
import type { CategoryNode } from '@/features/search/types';
import { ApiError } from '@/lib/api/errors';

export async function generateMetadata({ searchParams }: PageProps<'/explore'>): Promise<Metadata> {
  const f = parseFilters(await searchParams);
  const where = f.city ? ` in ${f.city}` : '';
  return {
    title: f.q ? `“${f.q}”${where}` : `Explore${where}`,
    description: 'Find places to book an appointment or join a queue: open now, near you, top rated.',
  };
}

const findCategory = (tree: CategoryNode[], slug: string): CategoryNode | undefined =>
  tree.flatMap((c) => [c, ...c.children]).find((c) => c.slug === slug);

export default async function ExplorePage({ searchParams }: PageProps<'/explore'>) {
  const filters = parseFilters(await searchParams);
  const [results, cityList, tree] = await Promise.all([
    searchBusinesses(filters).catch((e: unknown) => e as ApiError),
    cities().catch(() => []),
    categoryTree().catch(() => []),
  ]);
  const categoryName = filters.category ? findCategory(tree, filters.category)?.name : undefined;
  const filtered = activeFilterCount(filters) > 0;

  return (
    <Container className="flex flex-col gap-8 py-10 sm:py-14">
      <header className="flex flex-col gap-5">
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">
          {filters.q ? `Results for “${filters.q}”` : 'Explore'}
          {filters.city && <span className="text-ink-3"> in {filters.city}</span>}
        </h1>
        <div className="max-w-2xl">
          <SearchBox defaultValue={filters.q} city={filters.city || undefined} size="md" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PlaceControls base="/explore" filters={filters} cities={cityList} />
        </div>
        <FilterChips base="/explore" filters={filters} categoryName={categoryName} />
        <NearMe filters={filters} />
      </header>

      {results instanceof Error ? (
        <ErrorState
          title="Search isn’t answering right now"
          message="Please try again in a moment."
          reference={results instanceof ApiError ? results.requestId : undefined}
          action={
            <Button asChild>
              <Link href={`/explore${filtersQuery(filters)}` as Route}>Try again</Link>
            </Button>
          }
        />
      ) : results.data.length === 0 && filters.page > 1 ? (
        <EmptyState
          icon={SearchX}
          title={`There’s no page ${filters.page} for this search`}
          action={
            <Button asChild variant="primary">
              <Link href={`/explore${filtersQuery(withFilters(filters, { page: 1 }))}` as Route}>
                Go to page 1
              </Link>
            </Button>
          }
        >
          The results may have changed since this link was made.
        </EmptyState>
      ) : results.data.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filtered || filters.q ? 'No places match all of that' : 'No places listed here yet'}
          action={
            filtered || filters.q || filters.city ? (
              <Button asChild variant="primary">
                <Link href="/explore">Start a fresh search</Link>
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
          <h2 id="results" className="text-ink-2" aria-live="polite">
            {results.meta!.total} {results.meta!.total === 1 ? 'place' : 'places'}
            {results.meta!.totalPages > 1 && ` · page ${filters.page} of ${results.meta!.totalPages}`}
          </h2>
          <BusinessGrid items={results.data} label="Places" />
          <Pagination base="/explore" filters={filters} totalPages={results.meta!.totalPages} />
        </section>
      )}
    </Container>
  );
}

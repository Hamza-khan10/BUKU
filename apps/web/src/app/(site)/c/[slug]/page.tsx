import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { CategoryIcon } from '@/features/categories/icons';
import { category, cities, searchBusinesses } from '@/features/search/api';
import { BusinessGrid } from '@/features/search/components/business-card';
import { FilterChips, Pagination } from '@/features/search/components/filters';
import { PlaceControls } from '@/features/search/components/place-controls';
import { activeFilterCount, parseFilters } from '@/features/search/params';
import { ApiError } from '@/lib/api/errors';

type Props = PageProps<'/c/[slug]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const node = await category((await params).slug).catch(() => null);
  if (!node) return { title: 'Category not found' };
  return {
    title: node.name,
    description: `${node.name} on BUKU: book a time or join the queue — see who’s open now and top rated.`,
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const node = await category(slug);
  if (!node) notFound();
  const base = `/c/${node.slug}`;
  // The path names the category; the address carries only the other filters.
  const filters = { ...parseFilters(await searchParams), category: '' };
  const filtered = activeFilterCount(filters) > 0 || Boolean(filters.city);
  const [results, cityList] = await Promise.all([
    searchBusinesses({ ...filters, category: node.slug }).catch((e: unknown) => e as ApiError),
    cities().catch(() => []),
  ]);

  return (
    <Container className="flex flex-col gap-8 py-10 sm:py-14">
      <header className="flex flex-col gap-5">
        {node.parent && (
          <nav aria-label="Breadcrumb" className="text-sm text-ink-3">
            <Link href="/categories" className="hover:text-ink hover:underline">
              Categories
            </Link>{' '}
            /{' '}
            <Link href={`/c/${node.parent.slug}` as Route} className="hover:text-ink hover:underline">
              {node.parent.name}
            </Link>
          </nav>
        )}
        <div className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink">
            <CategoryIcon slug={node.slug} className="size-7" />
          </span>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            {node.name}
            {filters.city && <span className="text-ink-3"> in {filters.city}</span>}
          </h1>
        </div>
        {node.children.length > 0 && (
          <ul aria-label={`Kinds of ${node.name}`} className="flex flex-wrap gap-2">
            {node.children.map((child) => (
              <li key={child.slug}>
                <Link
                  href={`/c/${child.slug}` as Route}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink-2 hover:text-ink"
                >
                  <CategoryIcon slug={child.slug} className="size-4" />
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <PlaceControls base={base} filters={filters} cities={cityList} />
        <FilterChips base={base} filters={filters} />
      </header>

      {results instanceof Error ? (
        <ErrorState
          title="This list isn’t loading right now"
          message="Please try again in a moment."
          reference={results instanceof ApiError ? results.requestId : undefined}
        />
      ) : results.data.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filtered ? 'No places match all of that' : `No ${node.name.toLowerCase()} on BUKU yet`}
          action={
            <Button asChild>
              <Link href="/explore">Explore everything</Link>
            </Button>
          }
        >
          {filtered
            ? 'Try turning off a filter, or another city.'
            : 'When places like this join BUKU, they’ll appear here.'}
        </EmptyState>
      ) : (
        <section aria-labelledby="results" className="flex flex-col gap-6">
          <h2 id="results" className="text-ink-2">
            {results.meta!.total} {results.meta!.total === 1 ? 'place' : 'places'}
          </h2>
          <BusinessGrid items={results.data} label={node.name} />
          <Pagination base={base} filters={filters} totalPages={results.meta!.totalPages} />
        </section>
      )}
    </Container>
  );
}

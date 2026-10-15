import type { Metadata } from 'next';
import { Container } from '@/components/ui/layout';
import { categoryTree, cities, searchBusinesses } from '@/features/search/api';
import { Explore } from '@/features/search/components/explore';
import type { ExplorePage } from '@/features/search/explore';
import { parseFilters } from '@/features/search/params';
import { ApiError } from '@/lib/api/errors';

export async function generateMetadata({ searchParams }: PageProps<'/explore'>): Promise<Metadata> {
  const f = parseFilters(await searchParams);
  const where = f.city ? ` in ${f.city}` : '';
  return {
    title: f.q ? `“${f.q}”${where}` : `Explore${where}`,
    description: 'Find places to book an appointment or join a queue: open now, near you, top rated.',
  };
}

/**
 * The first page of a search, rendered here (fast, and readable by search engines); the rest of
 * the page lives in the browser (D-104). An old link to a later page starts at the beginning:
 * results now continue as you scroll.
 */
export default async function ExploreRoute({ searchParams }: PageProps<'/explore'>) {
  const filters = { ...parseFilters(await searchParams), page: 1 };
  const [first, cityList, tree] = await Promise.all([
    searchBusinesses(filters).catch((e: unknown) => (e instanceof Error ? e : new Error('Search failed'))),
    cities().catch(() => []),
    categoryTree().catch(() => []),
  ]);
  const initial: ExplorePage | { error: string; requestId?: string | undefined } =
    first instanceof Error
      ? { error: first.message, requestId: first instanceof ApiError ? first.requestId : undefined }
      : {
          items: first.data,
          meta: first.meta ?? {
            page: 1,
            limit: first.data.length,
            total: first.data.length,
            totalPages: 1,
            sort: filters.sort,
          },
        };

  return (
    <Container className="py-8 sm:py-14">
      <Explore initial={initial} initialFilters={filters} cities={cityList} tree={tree} />
    </Container>
  );
}

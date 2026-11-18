import type { Metadata, Route } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container, PageHeading } from '@/components/ui/layout';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { CategoryGuide } from '@/features/categories/components/category-guide';
import {
  breadcrumbData,
  categoryCopy,
  categoryLead,
  placeOf,
  type Placed,
} from '@/features/categories/guide';
import { CategoryIcon } from '@/features/categories/icons';
import { CATEGORY_SNAPSHOT } from '@/features/categories/snapshot';
import { category, cities, searchBusinesses } from '@/features/search/api';
import { BusinessGrid } from '@/features/search/components/business-card';
import { FilterChips, Pagination } from '@/features/search/components/filters';
import { PlaceControls } from '@/features/search/components/place-controls';
import { activeFilterCount, parseFilters } from '@/features/search/params';
import { ApiError } from '@/lib/api/errors';
import { apiConfigured, prelaunch } from '@/lib/flags';
import { jsonLd, pageMetadata } from '@/lib/seo';
import { siteUrl } from '@/lib/site-url';

type Props = PageProps<'/c/[slug]'>;

/**
 * Where a category sits: in the catalog BUKU starts with (kept in the site), or, for a kind added
 * since, as the API tells it. Before launch only the first (there is no API).
 */
async function placeFor(slug: string): Promise<Placed | null> {
  const known = placeOf(slug);
  if (known || prelaunch() || !apiConfigured()) return known;
  const node = await category(slug).catch(() => null);
  if (!node) return null;
  const parent = node.parent
    ? { id: '', slug: node.parent.slug, name: node.parent.name, icon: null, children: [] }
    : null;
  return { node, parent };
}

/** The kinds around a kind, or the other groups around a group. */
function siblingsOf({ node, parent }: Placed) {
  const around = parent ? (placeOf(parent.slug)?.node.children ?? []) : CATEGORY_SNAPSHOT;
  return around.filter((c) => c.slug !== node.slug).map((c) => ({ slug: c.slug, name: c.name }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const placed = await placeFor((await params).slug);
  if (!placed) return { title: 'Category not found' };
  // Worded the way people search for it (D-139); one address whatever the filters.
  return pageMetadata({ ...categoryCopy(placed), path: `/c/${placed.node.slug}` });
}

/**
 * Before launch (D-139): the category's own guide, so the page stands without the API and can be
 * found in search; after launch the same address lists the places, with the guide after them.
 */
function GuidePage({ placed, nonce, early }: { placed: Placed; nonce: string | undefined; early: boolean }) {
  const { node, parent } = placed;
  return (
    <Container className="flex flex-col gap-14 py-8 sm:gap-20 sm:py-14">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData(siteUrl(), placed)) }}
      />
      <PageHeading
        back={
          <nav aria-label="Breadcrumb" className="text-sm text-ink-3">
            <Link href="/categories" className="hover:text-ink hover:underline">
              Categories
            </Link>
            {parent && (
              <>
                {' '}
                /{' '}
                <Link href={`/c/${parent.slug}` as Route} className="hover:text-ink hover:underline">
                  {parent.name}
                </Link>
              </>
            )}
          </nav>
        }
        aside={
          <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-brand-soft text-brand-ink sm:size-16 sm:rounded-2xl">
            <CategoryIcon slug={node.slug} className="size-6 sm:size-8" />
          </span>
        }
        title={node.name}
        description={categoryLead(placed)}
      />
      <CategoryGuide placed={placed} siblings={siblingsOf(placed)} early={early} nonce={nonce} />
    </Container>
  );
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  if (prelaunch() || !apiConfigured()) {
    const placed = placeOf(slug);
    if (!placed) notFound();
    return <GuidePage placed={placed} nonce={nonce} early={prelaunch()} />;
  }
  const node = await category(slug).catch(() => undefined);
  if (node === undefined) {
    // The API isn't answering: the guide still stands, from the catalog BUKU starts with.
    const known = placeOf(slug);
    if (!known) notFound();
    return <GuidePage placed={known} nonce={nonce} early={false} />;
  }
  if (!node) notFound();
  const placed = (await placeFor(slug)) ?? { node, parent: null };
  const base = `/c/${node.slug}`;
  // The path names the category; the address carries only the other filters.
  const filters = { ...parseFilters(await searchParams), category: '' };
  const filtered = activeFilterCount(filters) > 0 || Boolean(filters.city);
  const [results, cityList] = await Promise.all([
    searchBusinesses({ ...filters, category: node.slug }).catch((e: unknown) => e as ApiError),
    cities().catch(() => []),
  ]);

  return (
    <Container className="flex flex-col gap-8 py-8 sm:py-14">
      <PageHeading
        back={
          node.parent && (
            <nav aria-label="Breadcrumb" className="text-sm text-ink-3">
              <Link href="/categories" className="hover:text-ink hover:underline">
                Categories
              </Link>{' '}
              /{' '}
              <Link href={`/c/${node.parent.slug}` as Route} className="hover:text-ink hover:underline">
                {node.parent.name}
              </Link>
            </nav>
          )
        }
        aside={
          <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-brand-soft text-brand-ink sm:size-16 sm:rounded-2xl">
            <CategoryIcon slug={node.slug} className="size-6 sm:size-8" />
          </span>
        }
        title={
          filters.city ? (
            <>
              {node.name}
              <span className="text-ink-3"> in {filters.city}</span>
            </>
          ) : (
            node.name
          )
        }
      >
        {node.children.length > 0 && (
          <ul
            aria-label={`Kinds of ${node.name}`}
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          >
            {node.children.map((child) => (
              <li key={child.slug} className="shrink-0">
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
      </PageHeading>

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

      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData(siteUrl(), placed)) }}
      />
      <div className="mt-8 border-t border-line pt-14 sm:mt-12 sm:pt-20">
        <CategoryGuide placed={placed} siblings={siblingsOf(placed)} early={false} nonce={nonce} />
      </div>
    </Container>
  );
}

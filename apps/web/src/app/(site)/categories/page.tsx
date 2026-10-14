import { ArrowRight, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { StackedCards } from '@/components/motion/stacked-cards';
import { Container, PageHeading } from '@/components/ui/layout';
import { ErrorState } from '@/components/ui/states';
import { CategoryFinder } from '@/features/categories/components/category-finder';
import { GroupIndex } from '@/features/categories/components/group-index';
import { groupBlurb } from '@/features/categories/groups';
import { CategoryIcon } from '@/features/categories/icons';
import { categoryTree } from '@/features/search/api';
import type { CategoryNode } from '@/features/search/types';
import { ApiError } from '@/lib/api/errors';

export const metadata = {
  title: 'All categories',
  description:
    'Every kind of place on BUKU, from barbers and clinics to padel courts and passport offices, in plain groups.',
};

/**
 * Every kind of place, made easy to find (D-102): find one by typing part of its name; jump to
 * a group; or browse the groups, each a card that says in one line what's in it and lists its
 * kinds in readable rows, laid one over another as the page scrolls where they fit the screen.
 */
export default async function CategoriesPage() {
  let tree: CategoryNode[];
  try {
    tree = await categoryTree();
  } catch (e) {
    return (
      <Container className="py-16">
        <ErrorState
          title="Categories aren’t loading right now"
          message="Please try again in a moment."
          reference={e instanceof ApiError ? e.requestId : undefined}
        />
      </Container>
    );
  }
  const groups = tree.filter((g) => g.children.length > 0);
  const kinds = groups.reduce((n, g) => n + g.children.length, 0);

  return (
    <Container className="flex flex-col gap-12 py-10 sm:gap-16 sm:py-14">
      <div className="flex flex-col gap-8">
        <PageHeading
          eyebrow="Categories"
          title="Every kind of place"
          description={`${kinds} kinds of place in ${groups.length} groups. Type what you’re looking for, or pick a group.`}
        />
        <CategoryFinder
          groups={groups.map((g) => ({
            slug: g.slug,
            name: g.name,
            kinds: g.children.map((c) => ({ slug: c.slug, name: c.name })),
          }))}
        />
        <GroupIndex groups={groups.map((g) => ({ slug: g.slug, name: g.name, count: g.children.length }))} />
      </div>

      <StackedCards
        ids={groups.map((g) => g.slug)}
        cards={groups.map((g) => (
          <GroupCard key={g.slug} group={g} />
        ))}
      />

      <aside className="flex flex-col items-start gap-3 rounded-2xl bg-sunken p-6 sm:p-8">
        <h2 className="type-heading">Run a kind of business that isn’t here?</h2>
        <p className="max-w-2xl text-base leading-relaxed text-ink-2">
          When you add your business, choose “Something else…” and name your kind. BUKU checks it isn’t
          already listed under another name, and it can be used straight away.
        </p>
        <Link
          href="/business/new"
          className="inline-flex items-center gap-1.5 font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          Add your business
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </aside>
    </Container>
  );
}

function GroupCard({ group }: { group: CategoryNode }) {
  const blurb = groupBlurb(group.slug);
  const heading = `group-${group.slug}`;
  return (
    <section
      aria-labelledby={heading}
      className="grid gap-6 rounded-2xl bg-surface p-4 shadow-lift ring-1 ring-line sm:p-6 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-8"
    >
      <div className="flex flex-col gap-4 rounded-xl bg-brand-soft p-5">
        <span className="grid size-12 place-items-center rounded-full bg-surface text-brand-ink">
          <CategoryIcon slug={group.slug} className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2
            id={heading}
            tabIndex={-1}
            className="text-[1.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink outline-none"
          >
            {group.name}
          </h2>
          {blurb && <p className="text-base leading-relaxed text-ink-2">{blurb}</p>}
        </div>
        <Link
          href={`/c/${group.slug}` as Route}
          className="mt-auto inline-flex items-center gap-1.5 font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          See all places<span className="sr-only"> in {group.name}</span>
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        <p className="px-3 text-sm font-medium text-ink-2">
          {group.children.length} {group.children.length === 1 ? 'kind' : 'kinds'} of place
        </p>
        <ul
          aria-label={`Kinds of place in ${group.name}`}
          className="grid gap-x-1 gap-y-0.5 min-[22.5rem]:grid-cols-2 sm:gap-x-2 xl:grid-cols-3"
        >
          {group.children.map((kind) => (
            <li key={kind.slug}>
              <Link
                href={`/c/${kind.slug}` as Route}
                className="group flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-2 text-[0.95rem] leading-snug font-medium text-ink transition-colors hover:bg-sunken sm:gap-3 sm:px-3"
              >
                <CategoryIcon slug={kind.slug} className="size-[1.125rem] shrink-0 text-brand-ink" />
                <span className="min-w-0 flex-1 break-words hyphens-auto">{kind.name}</span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

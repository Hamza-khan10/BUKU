import type { Route } from 'next';
import Link from 'next/link';
import { Container, PageHeading } from '@/components/ui/layout';
import { ErrorState } from '@/components/ui/states';
import { CategoryIcon } from '@/features/categories/icons';
import { categoryTree } from '@/features/search/api';
import type { CategoryNode } from '@/features/search/types';
import { ApiError } from '@/lib/api/errors';

export const metadata = {
  title: 'All categories',
  description: 'Barbers, clinics, spas, gyms, government offices and more — every kind of place on BUKU.',
};

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

  return (
    <Container className="flex flex-col gap-10 py-10 sm:py-14">
      <PageHeading
        eyebrow="Categories"
        title="Every kind of place"
        description="Pick a category to see the places in it — open now, with a queue, top rated."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tree.map((c) => (
          <li
            key={c.slug}
            className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-soft"
          >
            <Link href={`/c/${c.slug}` as Route} className="group flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-ink">
                <CategoryIcon slug={c.slug} className="size-6" />
              </span>
              <span className="font-display text-xl font-semibold group-hover:underline">{c.name}</span>
            </Link>
            {c.children.length > 0 && (
              <ul aria-label={`In ${c.name}`} className="flex flex-wrap gap-2">
                {c.children.map((child) => (
                  <li key={child.slug}>
                    <Link
                      href={`/c/${child.slug}` as Route}
                      className="inline-flex h-9 items-center rounded-full bg-sunken px-3 text-sm text-ink-2 hover:text-ink"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Container>
  );
}

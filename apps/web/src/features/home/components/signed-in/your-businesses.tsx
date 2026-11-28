'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { CategoryIcon } from '@/features/categories/icons';
import { fetchMine, MINE_KEY, ROLE_LABELS } from '@/features/manage/api';

const SHOWN = 3;

/**
 * For people who run or work at a business: a way straight into each workspace from home (the
 * first three; the rest one tap away). Nothing at all for everyone else.
 */
export function YourBusinesses() {
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: fetchMine });
  const list = mine.data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="your-businesses" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h2 id="your-businesses" className="type-heading">
          {list.length === 1 ? 'Your business' : 'Your businesses'}
        </h2>
        {list.length > SHOWN && (
          <Link
            href="/business"
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            All {list.length} businesses
          </Link>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.slice(0, SHOWN).map((b) => (
          <li key={b.id}>
            <Link
              href={`/business/${b.id}` as Route}
              className="flex items-center gap-3 rounded-xl bg-surface p-3.5 ring-1 ring-line transition-[box-shadow] duration-300 hover:ring-control"
            >
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-brand-soft text-brand-ink">
                {b.logoUrl ? (
                  <img src={b.logoUrl} alt="" className="size-full object-cover" />
                ) : (
                  <CategoryIcon slug={b.category.slug} className="size-5" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-ink">{b.name}</span>
                <span className="truncate text-sm text-ink-3">
                  {ROLE_LABELS[b.myRole]} in {b.address.city}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

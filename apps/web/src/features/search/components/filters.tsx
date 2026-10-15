'use client';

import { Check, X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { MouseEvent } from 'react';
import { cn } from '@/lib/cn';
import { filtersQuery, withFilters, type Filters } from '../params';

/**
 * Filter chips: each one is a plain link to the same search with that filter
 * switched — so filters work without scripts, and every search can be shared.
 * On phones they sit in one row you swipe, so the results start sooner. Given `onFilters` (the
 * explore page), a plain click changes the search in place instead; a new tab still opens the link.
 */
export function FilterChips({
  base,
  filters,
  categoryName,
  onFilters,
  className,
}: {
  base: string;
  filters: Filters;
  categoryName?: string | undefined;
  onFilters?: ((f: Filters) => void) | undefined;
  className?: string | undefined;
}) {
  const chips: { key: keyof Filters; label: string; on: boolean }[] = [
    { key: 'openNow', label: 'Open now', on: filters.openNow },
    { key: 'hasQueue', label: 'Queue open', on: filters.hasQueue },
    { key: 'verifiedOnly', label: 'Verified', on: filters.verifiedOnly },
    { key: 'topRated', label: '4 stars & up', on: filters.topRated },
  ];
  const link = (change: Partial<Filters>) => `${base}${filtersQuery(withFilters(filters, change))}` as Route;
  const inPlace = (change: Partial<Filters>) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onFilters || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onFilters(withFilters(filters, change));
  };
  const chip =
    'inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors';
  return (
    <ul
      aria-label="Filters"
      className={cn(
        'relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 sm:[mask-image:none]',
        className,
      )}
    >
      {chips.map(({ key, label, on }) => (
        <li key={key} className="shrink-0">
          <Link
            href={link({ [key]: !on })}
            onClick={inPlace({ [key]: !on })}
            scroll={false}
            className={cn(
              chip,
              on
                ? 'border-ink bg-ink text-canvas'
                : 'border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
            )}
          >
            {on && <Check className="size-4" aria-hidden />}
            {label}
            <span className="sr-only">{on ? ' (on, select to turn off)' : ' (off)'}</span>
          </Link>
        </li>
      ))}
      {filters.category && categoryName && base === '/explore' && (
        <li className="shrink-0">
          <Link
            href={link({ category: '' })}
            onClick={inPlace({ category: '' })}
            scroll={false}
            className={cn(chip, 'border-ink bg-ink text-canvas')}
          >
            {categoryName}
            <X className="size-4" aria-hidden />
            <span className="sr-only"> (remove this category)</span>
          </Link>
        </li>
      )}
    </ul>
  );
}

/** "Previous · 2 of 5 · Next" — plain links, the current page marked. */
export function Pagination({
  base,
  filters,
  totalPages,
}: {
  base: string;
  filters: Filters;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const page = filters.page;
  const href = (p: number) => `${base}${filtersQuery(withFilters(filters, { page: p }))}` as Route;
  const button =
    'inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 font-medium hover:bg-sunken';
  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={button} rel="prev">
          Previous
        </Link>
      ) : (
        <span className={cn(button, 'pointer-events-none opacity-50')} aria-disabled>
          Previous
        </span>
      )}
      <span className="text-sm text-ink-2" aria-current="page">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className={button} rel="next">
          Next
        </Link>
      ) : (
        <span className={cn(button, 'pointer-events-none opacity-50')} aria-disabled>
          Next
        </span>
      )}
    </nav>
  );
}

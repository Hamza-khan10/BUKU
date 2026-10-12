import { BadgeCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { LiveDot } from '@/components/ui/live-dot';
import { RatingInline } from '@/features/business/components/rating';
import { CategoryIcon } from '@/features/categories/icons';
import { cn } from '@/lib/cn';
import { distance, money } from '@/lib/format';
import type { SearchItem } from '../types';

/** The first letter of a name, for a place without a picture (any script). */
const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '';

/**
 * A place in a list. Everything on it comes from the place itself: its own
 * photo (or, without one, its logo or initial on BUKU's mint: never a stock
 * picture), open now and a live queue, rating or "No reviews yet", verified or
 * not, the lowest price. A picture and quiet text, not a box (WEB_PLAN §2). The
 * whole thing is one link (the name carries it, so screen readers hear the name).
 *
 * `row` lays it out as a phone list row (picture beside the text) below `sm`, so
 * a list of places is quick to scan on a phone instead of a screen per place.
 */
export function BusinessCard({ item, row = false }: { item: SearchItem; row?: boolean }) {
  return (
    <article
      className={cn(
        'group relative flex h-full gap-3.5',
        row ? 'flex-row items-start gap-4 sm:flex-col sm:items-stretch sm:gap-3.5' : 'flex-col',
      )}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-lg bg-brand-soft',
          row
            ? 'aspect-square w-[6.5rem] shrink-0 rounded-xl sm:aspect-[4/3] sm:w-auto sm:rounded-lg'
            : 'aspect-[4/3]',
        )}
      >
        {item.coverPhotoUrl ? (
          <img
            src={item.coverPhotoUrl}
            alt=""
            width={640}
            height={480}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-700 ease-(--ease-out) group-hover:scale-[1.04]"
          />
        ) : (
          <div aria-hidden className="relative grid size-full place-items-center">
            {item.logoUrl ? (
              <img
                src={item.logoUrl}
                alt=""
                width={96}
                height={96}
                loading="lazy"
                decoding="async"
                className="size-24 rounded-2xl object-cover shadow-soft"
              />
            ) : (
              <span
                className={cn(
                  'leading-none font-semibold tracking-[-0.04em] text-brand-ink transition-transform duration-700 ease-(--ease-out) group-hover:scale-[1.04]',
                  row ? 'text-[2.6rem] sm:text-[4.25rem]' : 'text-[4.25rem]',
                )}
              >
                {initial(item.name)}
              </span>
            )}
            <span
              className={cn(
                'absolute grid place-items-center rounded-full bg-surface/90 text-ink-2 shadow-soft',
                row ? 'bottom-1.5 left-1.5 size-7 sm:bottom-3 sm:left-3 sm:size-9' : 'bottom-3 left-3 size-9',
              )}
            >
              <CategoryIcon slug={item.category.slug} className="size-4" />
            </span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[1.05rem] leading-snug font-semibold tracking-[-0.01em]">
            <Link
              href={`/b/${item.slug}` as Route}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            >
              {item.name}
            </Link>
          </h3>
          {item.verified && (
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm text-ok">
              <BadgeCheck className="size-4" aria-hidden />
              <span className={cn(row && 'max-sm:sr-only')}>Verified</span>
            </span>
          )}
        </div>
        <p className="text-sm text-ink-3">
          {item.category.name} · {item.city}
          {item.distanceKm !== null && `, ${distance(item.distanceKm)}`}
        </p>
        <RatingInline average={item.rating.average} count={item.rating.count} />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-sm">
          {item.openNow ? (
            <span className="font-medium text-ok">Open now</span>
          ) : (
            <span className="text-ink-3">Closed now</span>
          )}
          {item.queue?.open && (
            <span className="inline-flex items-center gap-1.5 font-medium text-wait-ink">
              <LiveDot tone="wait" /> {item.queue.waiting} waiting
            </span>
          )}
          {item.priceFrom && (
            <span className="text-ink-2">From {money(item.priceFrom.amount, item.priceFrom.currency)}</span>
          )}
        </p>
        {!item.verified && <p className="text-sm text-ink-3">Not verified yet</p>}
        {item.reliability && (
          <p className={cn('text-sm text-ink-2', row && 'max-sm:hidden')}>
            Keeps {item.reliability.keptPercent}% of bookings
          </p>
        )}
      </div>
      {/* The focus ring follows the link inside. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-2 rounded-xl ring-focus group-focus-within:ring-2"
      />
    </article>
  );
}

/** A grid of cards; on phones, a list of rows, each rising in as it scrolls into view. */
export function BusinessGrid({ items, label }: { items: SearchItem[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-x-6 gap-y-6 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-3">
      {items.map((item, i) => (
        <li key={item.id} className="reveal" style={{ '--i': i % 3 } as CSSProperties}>
          <BusinessCard item={item} row />
        </li>
      ))}
    </ul>
  );
}

import { BadgeCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { LiveDot } from '@/components/ui/live-dot';
import { RatingInline } from '@/features/business/components/rating';
import { CategoryIcon } from '@/features/categories/icons';
import { distance, money } from '@/lib/format';
import type { SearchItem } from '../types';

/** The first letter of a name, for a place without a picture (any script). */
const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '';

/**
 * A place in a list. Everything on it comes from the place itself: its own
 * photo (or, without one, its logo or initial: never a stock picture), open
 * now and a live queue, rating or "No reviews yet", verified or not, the
 * lowest price. A picture and quiet text, not a box (WEB_PLAN §2). The whole
 * thing is one link (the name carries it, so screen readers hear the name).
 */
export function BusinessCard({ item }: { item: SearchItem }) {
  return (
    <article className="group relative flex h-full flex-col gap-3.5">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-sunken">
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
              <span className="text-[4.25rem] leading-none font-medium tracking-[-0.04em] text-ink-3 transition-transform duration-700 ease-(--ease-out) group-hover:scale-[1.04]">
                {initial(item.name)}
              </span>
            )}
            <span className="absolute bottom-3 left-3 grid size-9 place-items-center rounded-full bg-surface/90 text-ink-2 shadow-soft">
              <CategoryIcon slug={item.category.slug} className="size-4" />
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
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
              <BadgeCheck className="size-4" aria-hidden /> Verified
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
          <p className="text-sm text-ink-2">Keeps {item.reliability.keptPercent}% of bookings</p>
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

/** A grid of cards (one column on phones). */
export function BusinessGrid({ items, label }: { items: SearchItem[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <BusinessCard item={item} />
        </li>
      ))}
    </ul>
  );
}

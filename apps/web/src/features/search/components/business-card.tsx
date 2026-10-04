import type { Route } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LiveDot } from '@/components/ui/live-dot';
import { RatingInline } from '@/features/business/components/rating';
import { CategoryIcon } from '@/features/categories/icons';
import { distance, money } from '@/lib/format';
import type { SearchItem } from '../types';

/**
 * A place in a list. Everything on it comes from the place itself: its own
 * photo (or its category's icon), rating or "No reviews yet", verified or
 * not, open now, a live queue, the lowest price. The whole card is one link
 * (the name carries it, so screen readers hear the name).
 */
export function BusinessCard({ item }: { item: SearchItem }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-soft transition-shadow hover:shadow-lift focus-within:shadow-lift">
      <div className="relative aspect-[16/9] overflow-hidden bg-sunken">
        {item.coverPhotoUrl ? (
          <img
            src={item.coverPhotoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div aria-hidden className="grid size-full place-items-center bg-brand-soft text-brand-ink">
            <CategoryIcon slug={item.category.slug} className="size-10 opacity-80" />
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {item.openNow ? (
            <Badge tone="ok" className="bg-surface/95">
              Open now
            </Badge>
          ) : (
            <Badge className="bg-surface/95">Closed now</Badge>
          )}
          {item.queue?.open && (
            <Badge tone="wait" className="bg-surface/95">
              <LiveDot tone="wait" className="mr-0.5" /> Queue · {item.queue.waiting} waiting
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-sm text-ink-3">
          {item.category.name} · {item.city}
          {item.distanceKm !== null && ` · ${distance(item.distanceKm)}`}
        </p>
        <h3 className="font-display text-lg leading-snug font-semibold">
          <Link
            href={`/b/${item.slug}` as Route}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {item.name}
          </Link>
        </h3>
        <RatingInline average={item.rating.average} count={item.rating.count} />
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-sm">
          {item.priceFrom && (
            <span className="font-medium text-ink">
              From {money(item.priceFrom.amount, item.priceFrom.currency)}
            </span>
          )}
          {item.verified ? (
            <span className="text-ok">Verified</span>
          ) : (
            <span className="text-ink-3">Not verified</span>
          )}
          {item.reliability && (
            <span className="text-ink-2">Keeps {item.reliability.keptPercent}% of bookings</span>
          )}
        </div>
      </div>
      {/* The card's focus ring follows the link inside it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-lg ring-focus group-focus-within:ring-2"
      />
    </article>
  );
}

/** A grid of cards (one column on phones). */
export function BusinessGrid({ items, label }: { items: SearchItem[]; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <BusinessCard item={item} />
        </li>
      ))}
    </ul>
  );
}

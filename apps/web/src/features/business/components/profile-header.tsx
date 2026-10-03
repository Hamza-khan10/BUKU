import { BadgeCheck, CircleHelp, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Container } from '@/components/ui/layout';
import { Tooltip } from '@/components/ui/tooltip';
import { CategoryIcon } from '@/features/categories/icons';
import { openLabel, openState, wallClock } from '@/lib/format';
import type { BusinessProfile } from '../types';
import { RatingInline } from './rating';

/**
 * The top of a business page: its own cover photo (or, without one, a quiet
 * pattern with its category's icon — never a stock picture), logo, name,
 * and the facts people decide on: verified or not, rating, how reliably it
 * keeps bookings, open now.
 */
export function ProfileHeader({ business }: { business: BusinessProfile }) {
  const cover = business.photos.find((p) => p.isPrimary) ?? business.photos[0];
  const state = openState(business.hours, business.timezone);
  const today = wallClock(business.timezone).day;
  const verified = business.verification.status === 'verified';

  return (
    <header>
      <div className="relative h-44 overflow-hidden bg-night sm:h-64">
        {cover ? (
          // Alt text is the business's own description of its photo; without one the photo is decoration.
          <img
            src={cover.url}
            alt={cover.altText ?? ''}
            className="size-full object-cover"
            fetchPriority="high"
            decoding="async"
          />
        ) : (
          <div
            aria-hidden
            className="size-full bg-[radial-gradient(circle_at_20%_30%,color-mix(in_srgb,var(--brand)_55%,transparent),transparent_45%),radial-gradient(circle_at_85%_70%,color-mix(in_srgb,var(--wait)_35%,transparent),transparent_40%)]"
          />
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-night/55 to-transparent" />
      </div>

      <Container className="relative -mt-14 sm:-mt-16">
        <div className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-lift sm:flex-row sm:items-end sm:p-6">
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border-4 border-surface bg-brand-soft text-brand-ink shadow-soft sm:size-24">
            {business.logoUrl ? (
              <img src={business.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              <CategoryIcon slug={business.category.slug} className="size-9" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm font-medium text-ink-3">
              {business.category.name} · {business.address.city}
            </p>
            <h1 className="font-display text-3xl leading-tight font-bold tracking-tight break-words sm:text-4xl">
              {business.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <RatingInline average={business.rating.average} count={business.rating.count} />
              {verified ? (
                <Badge tone="ok">
                  <BadgeCheck aria-hidden /> Verified business
                </Badge>
              ) : (
                <Tooltip content="BUKU hasn’t checked this business’s legal details and documents yet. It can still take bookings.">
                  <button type="button" className="rounded-full">
                    <Badge tone="outline">
                      Not verified <CircleHelp aria-hidden />
                    </Badge>
                  </button>
                </Tooltip>
              )}
              {business.reliability && (
                <Badge tone="neutral">Keeps {business.reliability.keptPercent}% of bookings</Badge>
              )}
              <span
                className={
                  state.open
                    ? 'inline-flex items-center gap-1.5 text-sm font-medium text-ok'
                    : 'inline-flex items-center gap-1.5 text-sm text-ink-2'
                }
              >
                <Clock className="size-4" aria-hidden />
                {openLabel(state, today)}
              </span>
            </div>
          </div>
        </div>
      </Container>
    </header>
  );
}

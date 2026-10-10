import { BadgeCheck, CircleHelp, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Container } from '@/components/ui/layout';
import { Tooltip } from '@/components/ui/tooltip';
import { openLabel, openState, wallClock } from '@/lib/format';
import type { BusinessProfile } from '../types';
import { RatingInline } from './rating';

/**
 * The top of a business page: its own cover photo when it has one (never a
 * stock picture, and no invented banner when it hasn't), logo or initial,
 * name, and the facts people decide on: verified or not, rating, how
 * reliably it keeps bookings, open now.
 */
export function ProfileHeader({ business }: { business: BusinessProfile }) {
  const cover = business.photos.find((p) => p.isPrimary) ?? business.photos[0];
  const state = openState(business.hours, business.timezone);
  const today = wallClock(business.timezone).day;
  const verified = business.verification.status === 'verified';

  return (
    <header>
      {cover && (
        <Container className="pt-6">
          <div className="relative h-52 overflow-hidden rounded-2xl bg-sunken sm:h-80">
            {/* Alt text is the business's own description of its photo; without one the photo is decoration. */}
            <img
              src={cover.url}
              alt={cover.altText ?? ''}
              className="size-full object-cover"
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </Container>
      )}

      <Container className={cover ? 'relative -mt-12 sm:-mt-14' : 'pt-10 sm:pt-14'}>
        <div
          className={
            cover
              ? 'mx-3 flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-lift sm:mx-6 sm:flex-row sm:items-end sm:p-6'
              : 'flex flex-col gap-5 sm:flex-row sm:items-end'
          }
        >
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-surface text-ink-2 shadow-soft sm:size-24">
            {business.logoUrl ? (
              <img src={business.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              <span aria-hidden className="text-4xl font-semibold tracking-[-0.04em] text-ink/80">
                {[...business.name.trim()][0]?.toUpperCase()}
              </span>
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm font-medium text-ink-3">
              {business.category.name} · {business.address.city}
            </p>
            <h1 className="text-3xl leading-tight font-semibold tracking-[-0.03em] break-words sm:text-4xl">
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

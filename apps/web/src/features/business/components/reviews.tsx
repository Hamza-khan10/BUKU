import { EmptyState } from '@/components/ui/states';
import { ratingValue } from '@/lib/format';
import type { Review, ReviewsMeta } from '../types';
import { MoreReviews } from './more-reviews';
import { Stars } from './rating';
import { ReviewCard } from './review-card';

const DETAILS: [keyof ReviewsMeta['summary']['details'], string][] = [
  ['waitTime', 'Waiting time'],
  ['staff', 'Staff'],
  ['cleanliness', 'Cleanliness'],
  ['value', 'Value'],
];

/** Average, how the stars spread, and the four details people rate. */
function Summary({ summary }: { summary: ReviewsMeta['summary'] }) {
  return (
    <div className="grid gap-6 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[auto_1fr_1fr]">
      <div className="flex flex-col items-start gap-1">
        <p className="text-5xl font-semibold tracking-[-0.035em] tabular">{ratingValue(summary.average)}</p>
        <Stars value={summary.average} className="text-lg" />
        <p className="text-sm text-ink-3">
          {summary.count} {summary.count === 1 ? 'review' : 'reviews'} from real visits
        </p>
      </div>
      <ul aria-label="How the ratings spread" className="flex flex-col gap-1.5">
        {(['5', '4', '3', '2', '1'] as const).map((star) => {
          const n = summary.stars[star];
          const pct = summary.count ? Math.round((n / summary.count) * 100) : 0;
          return (
            <li key={star} className="flex items-center gap-2 text-sm">
              <span className="w-12 shrink-0 text-ink-2">{star} star</span>
              <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right text-ink-3 tabular">{n}</span>
            </li>
          );
        })}
      </ul>
      <dl className="flex flex-col gap-1.5 text-sm">
        {DETAILS.map(([key, label]) => {
          const value = summary.details[key];
          return (
            <div key={key} className="flex justify-between gap-4">
              <dt className="text-ink-2">{label}</dt>
              <dd className="font-medium text-ink tabular">
                {value === null ? 'Not rated yet' : ratingValue(value)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** Reviews: only from completed visits (D-077). The first page comes with the page; more on request. */
export function ReviewsSection({
  slug,
  businessName,
  reviews,
  meta,
}: {
  slug: string;
  businessName: string;
  reviews: Review[];
  meta: ReviewsMeta;
}) {
  if (meta.summary.count === 0) {
    return (
      <EmptyState title="No reviews yet">
        Reviews come only from people whose visit was completed, so the first one will be from a real
        customer.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Summary summary={meta.summary} />
      <ul className="flex flex-col gap-3">
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} businessName={businessName} />
        ))}
      </ul>
      {meta.totalPages > 1 && (
        <MoreReviews slug={slug} businessName={businessName} totalPages={meta.totalPages} />
      )}
    </div>
  );
}

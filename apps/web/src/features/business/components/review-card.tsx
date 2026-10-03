import { MessageSquareReply } from 'lucide-react';
import { monthLabel } from '@/lib/format';
import type { Review } from '../types';
import { Stars } from './rating';

/** One review: stars, who (first name + initial), when they visited, and the business's reply. */
export function ReviewCard({ review, businessName }: { review: Review; businessName: string }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Stars value={review.rating.overall} />
          <span className="sr-only">{review.rating.overall} out of 5</span>
          <span className="font-medium text-ink">{review.author}</span>
        </span>
        <span className="text-sm text-ink-3">
          Visited {monthLabel(review.visitedIn)}
          {review.edited && ' · edited'}
        </span>
      </div>
      {(review.service || review.staff) && (
        <p className="text-sm text-ink-3">
          {[review.service, review.staff && `with ${review.staff}`].filter(Boolean).join(' ')}
        </p>
      )}
      {review.comment && <p className="whitespace-pre-line text-ink-2">{review.comment}</p>}
      {review.response && (
        <div className="flex gap-3 rounded-md bg-sunken p-4">
          <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-ink">Reply from {businessName}</p>
            <p className="text-sm whitespace-pre-line text-ink-2">{review.response.text}</p>
          </div>
        </div>
      )}
    </li>
  );
}

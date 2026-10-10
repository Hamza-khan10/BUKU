'use client';

import { useQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Stars } from '@/features/business/components/rating';
import { monthLabel } from '@/lib/format';
import { ApiError } from '@/lib/api/errors';
import { fetchMyReviews, MY_REVIEWS_KEY } from '../api';
import { REVIEW_EDIT_DAYS } from '../rules';
import type { MyReview } from '../types';

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

function ReviewItem({ review: v }: { review: MyReview }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href={`/b/${v.business.slug}` as Route}
            className="text-lg tracking-[-0.015em] font-semibold text-ink hover:underline"
          >
            {v.business.name}
          </Link>
          <p className="text-sm text-ink-3">
            {[v.service, v.staff && `with ${v.staff}`].filter(Boolean).join(' ')} · visited in{' '}
            {monthLabel(v.visitedIn)}
          </p>
        </div>
        {!v.visible && <Badge tone="wait">Hidden by BUKU’s moderators</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <Stars value={v.rating.overall} />
        <span className="sr-only">{v.rating.overall} out of 5</span>
        {v.edited && <span className="text-xs text-ink-3">Edited</span>}
      </div>
      {v.comment && <p className="whitespace-pre-line text-ink-2">{v.comment}</p>}
      {v.response && (
        <div className="rounded-md bg-sunken p-3 text-sm">
          <p className="font-medium text-ink">Reply from {v.business.name}</p>
          <p className="mt-1 whitespace-pre-line text-ink-2">{v.response.text}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/appointments/${v.appointmentId}/review` as Route}>
            {v.canEdit ? 'Change or delete' : 'Delete'}
          </Link>
        </Button>
        <span className="text-xs text-ink-3">
          {v.canEdit
            ? `You can change it until ${shortDate(v.editableUntil)}.`
            : `Reviews can be changed for ${REVIEW_EDIT_DAYS} days after posting.`}
        </span>
      </div>
    </article>
  );
}

/** Every review I've written, newest first, as the business page shows them — and their replies. */
export function MyReviews() {
  const reviews = useQuery({ queryKey: MY_REVIEWS_KEY, queryFn: () => fetchMyReviews() });

  if (reviews.isPending) {
    return (
      <div role="status" aria-label="Loading your reviews" className="flex flex-col gap-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (reviews.isError) {
    const e = reviews.error instanceof ApiError ? reviews.error : null;
    return (
      <ErrorState
        title="We couldn’t load your reviews"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }
  if (reviews.data.items.length === 0) {
    return (
      <EmptyState icon={MessageSquareText} title="No reviews yet">
        After a visit, you can say how it went. It helps others choose, and helps the business improve.
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {reviews.data.items.map((v) => (
        <li key={v.id}>
          <ReviewItem review={v} />
        </li>
      ))}
    </ul>
  );
}

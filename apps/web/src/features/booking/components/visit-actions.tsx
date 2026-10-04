'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, MapPin, Repeat, Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { fetchMyReviews, MY_REVIEWS_KEY } from '@/features/reviews/api';
import { reviewable, visited } from '@/features/reviews/rules';
import { bookHref } from '../choices';
import { useMinute } from '../notice';
import { icsFileName, icsFor } from '../calendar';
import type { Receipt } from '../types';
import { CancelDialog } from './cancel-dialog';

/** Save the visit to the device's calendar (a file made right here; nothing is sent anywhere). */
function addToCalendar(r: Receipt) {
  const url = `${window.location.origin}/appointments/${r.id}`;
  const blob = new Blob([icsFor(r, url, new Date())], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = icsFileName(r);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * What can be done with a visit, only what the API allows right now (its
 * `policy`): add it to a calendar, move it (until the notice period), cancel
 * it; afterwards, book the same again.
 */
export function VisitActions({ receipt: r }: { receipt: Receipt }) {
  const live = (r.status === 'pending' || r.status === 'confirmed') && !r.checkedInAt;
  const minute = useMinute();
  const happened = minute !== null && visited(r, minute);
  const reviews = useQuery({ queryKey: MY_REVIEWS_KEY, queryFn: () => fetchMyReviews(), enabled: happened });
  const review = reviews.data?.items.find((v) => v.appointmentId === r.id);
  const canReview = minute !== null && reviews.isSuccess && !review && reviewable(r, minute);
  return (
    <div className="flex flex-wrap gap-3">
      {canReview && (
        <Button asChild variant="primary">
          <Link href={`/appointments/${r.id}/review` as Route}>
            <Star aria-hidden /> Review this visit
          </Link>
        </Button>
      )}
      {review && (
        <Button asChild variant="secondary">
          <Link href={`/appointments/${r.id}/review` as Route}>
            <Star aria-hidden /> Your review
          </Link>
        </Button>
      )}
      {live && (
        <Button variant="secondary" onClick={() => addToCalendar(r)}>
          <CalendarPlus aria-hidden /> Add to calendar
        </Button>
      )}
      {live && r.policy.canReschedule && (
        <Button asChild variant="secondary">
          <Link href={`/appointments/${r.id}/move` as Route}>
            <Repeat aria-hidden /> Move to another time
          </Link>
        </Button>
      )}
      {live && r.policy.canCancel && <CancelDialog receipt={r} />}
      {!live && (
        <Button asChild variant="secondary">
          <Link href={bookHref(r.business.slug, { serviceId: r.service.id }) as Route}>
            <Repeat aria-hidden /> Book this again
          </Link>
        </Button>
      )}
      <Button asChild variant="ghost">
        <Link href={`/b/${r.business.slug}` as Route}>
          <MapPin aria-hidden /> {r.business.name}
        </Link>
      </Button>
    </div>
  );
}

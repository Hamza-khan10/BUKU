'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { fetchVisits, VISITS_KEY } from '../api';
import { clockLabel, dayParts } from '../choices';
import type { Receipt } from '../types';

type Tone = 'neutral' | 'ok' | 'wait' | 'danger';

/** A visit's state in a word or two, for the list. */
export function visitBadge(r: Receipt, past: boolean): { label: string; tone: Tone } {
  switch (r.status) {
    case 'pending':
      return past
        ? { label: 'Not confirmed', tone: 'neutral' }
        : { label: 'Waiting to be confirmed', tone: 'wait' };
    case 'confirmed':
      return r.checkedInAt
        ? { label: 'Checked in', tone: 'ok' }
        : past
          ? { label: 'Booked', tone: 'neutral' }
          : { label: 'Confirmed', tone: 'ok' };
    case 'completed':
      return { label: 'Visited', tone: 'neutral' };
    case 'rescheduled':
      return { label: 'Moved', tone: 'neutral' };
    case 'cancelled':
      return {
        label:
          r.cancellation?.cancelledBy === 'user'
            ? 'Cancelled'
            : r.cancellation?.reasonCode === 'declined'
              ? 'Declined'
              : 'Cancelled by the business',
        tone: 'danger',
      };
    case 'no_show':
      return { label: 'Missed', tone: 'danger' };
  }
}

/** One visit as a row: the day as a little calendar leaf, what and where, and its state. */
export function VisitRow({ visit: r, past }: { visit: Receipt; past: boolean }) {
  const d = dayParts(r.local.date);
  const badge = visitBadge(r, past);
  return (
    <Link
      href={`/appointments/${r.id}` as Route}
      className="flex items-center gap-4 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-ink-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/25"
    >
      <span className="flex w-14 shrink-0 flex-col items-center rounded-md bg-sunken py-1.5 text-center">
        <span className="text-xs font-medium text-ink-3 uppercase">{d.weekday}</span>
        <span className="font-display text-xl leading-tight font-semibold text-ink tabular">{d.day}</span>
        <span className="text-xs text-ink-3">{d.month}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-ink">
          {r.service.name}
          {r.staff && <span className="font-normal text-ink-2"> with {r.staff.displayName}</span>}
        </span>
        <span className="truncate text-sm text-ink-2">
          {r.business.name} · {clockLabel(r.local.startTime)}
        </span>
      </span>
      <Badge tone={badge.tone} className="hidden sm:inline-flex">
        {badge.label}
      </Badge>
      <span className="sr-only">, {badge.label}</span>
    </Link>
  );
}

/** My visits, upcoming (soonest first) or past (latest first), a page at a time. */
export function VisitList({ scope }: { scope: 'upcoming' | 'past' }) {
  const visits = useInfiniteQuery({
    queryKey: VISITS_KEY(scope),
    queryFn: ({ pageParam }) => fetchVisits(scope, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const past = scope === 'past';

  if (visits.isPending) {
    return (
      <div role="status" aria-label="Loading your visits" className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (visits.isError) {
    const e = visits.error instanceof ApiError ? visits.error : null;
    return (
      <ErrorState
        title="We couldn’t load your visits"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
        action={
          <Button variant="secondary" onClick={() => void visits.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const items = visits.data.pages.flatMap((p) => p.items);
  if (items.length === 0) {
    return past ? (
      <EmptyState icon={CalendarDays} title="No past visits yet">
        Visits you’ve booked through BUKU show up here afterwards.
      </EmptyState>
    ) : (
      <EmptyState
        icon={CalendarDays}
        title="Nothing booked"
        action={
          <Button asChild variant="primary">
            <Link href="/explore">Find a place</Link>
          </Button>
        }
      >
        When you book a visit, it shows up here with its code.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {items.map((r) => (
          <li key={r.id}>
            <VisitRow visit={r} past={past} />
          </li>
        ))}
      </ul>
      {visits.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={visits.isFetchingNextPage}
          onClick={() => void visits.fetchNextPage()}
        >
          Show more
        </Button>
      )}
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import type { ManagedBusiness } from '../api';
import { countDay, dateIn, longDate, nextUp } from '../visits';
import { fetchVisits, visitsKey } from '../visits-api';
import { CodeCheckIn } from './check-in';
import { VisitRow } from './visits';

/** The time now, moving on every half minute (so "now" lines, buttons and counts keep up). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * Today at the front desk (3.5b): the day at a glance, check-in by code, and every visit in
 * time order with a line where "now" is. It refreshes itself every half minute, so a new
 * booking or a check-in on another tablet shows up without reloading.
 */
export function TodayBoard({ business }: { business: ManagedBusiness }) {
  const now = useNow();
  const day = useQuery({
    queryKey: visitsKey(business.id),
    queryFn: () => fetchVisits(business.id),
    refetchInterval: 30_000,
  });
  const today = dateIn(business.timezone, new Date(now));

  if (day.isError) {
    const e = day.error instanceof ApiError ? day.error : null;
    return (
      <ErrorState
        title="Today’s visits aren’t loading"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }

  const items = day.data?.items ?? [];
  const counts = countDay(items, now);
  const next = nextUp(items, now);
  const date = day.data?.date ?? today;
  // Where the "now" line goes: before the first visit that hasn't started yet.
  const nowAt = date === today ? items.findIndex((v) => Date.parse(v.startAt) > now) : -1;
  const tiles = [
    { label: 'Still to come', value: counts.toCome },
    { label: 'Here now', value: counts.here },
    { label: 'Done', value: counts.done },
    { label: 'Didn’t come', value: counts.missed },
  ];

  return (
    <section aria-labelledby="today" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="today" className="type-heading">
            Today
          </h2>
          <p className="text-ink-2">{longDate(date)}</p>
        </div>
        <Link
          href={`/business/${business.id}/appointments` as Route}
          className="inline-flex items-center gap-1.5 font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          All appointments
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      {day.isPending ? (
        <Skeleton className="h-24" />
      ) : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="flex flex-col gap-1 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line"
            >
              <dt className="text-sm text-ink-2">{t.label}</dt>
              <dd className="tabular text-3xl font-semibold tracking-[-0.03em] text-ink">{t.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {counts.toConfirm > 0 && (
        <Alert
          tone="wait"
          title={`${counts.toConfirm} ${counts.toConfirm === 1 ? 'booking is' : 'bookings are'} waiting for you to confirm`}
        >
          Confirm or decline them below; the customer is told either way.
        </Alert>
      )}

      <div className="rounded-xl bg-brand-soft p-5 sm:p-6">
        <CodeCheckIn businessId={business.id} />
        {next && (
          <p className="mt-3 text-sm text-ink-2">
            Next: <span className="font-semibold text-ink">{next.customer.name}</span> at{' '}
            {next.local.startTime}
            {next.staff && <> with {next.staff.displayName}</>}.
          </p>
        )}
      </div>

      {day.isPending ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="No bookings today">
          New bookings appear here by themselves, in time order.
        </EmptyState>
      ) : (
        <ol aria-label="Today’s visits" className="flex flex-col gap-3">
          {items.map((v, i) => (
            <Fragment key={v.id}>
              {i === nowAt && <NowLine timezone={business.timezone} now={now} />}
              <VisitRow visit={v} businessId={business.id} role={business.myRole} today={today} now={now} />
            </Fragment>
          ))}
          {nowAt === -1 && date === today && items.length > 0 && (
            <NowLine timezone={business.timezone} now={now} />
          )}
        </ol>
      )}
    </section>
  );
}

function NowLine({ timezone, now }: { timezone: string; now: number }) {
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(now));
  return (
    <li aria-label={`Now, ${time}`} className="flex items-center gap-3 py-1">
      <span className="tabular rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-on-brand">
        Now {time}
      </span>
      <span aria-hidden className={cn('h-0.5 flex-1 rounded-full bg-brand')} />
    </li>
  );
}

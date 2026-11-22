'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarCheck,
  CircleCheck,
  Clock,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
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
 * Today at the front desk (3.5b, laid out as a dashboard in D-133): the day's figures in one
 * strip, every visit in time order with a line where "now" is, and beside it what the desk reaches
 * for (check-in by code, who's next, `aside`). It refreshes itself every half minute, so a new
 * booking or a check-in on another tablet shows up without reloading.
 */
export function TodayBoard({ business, aside }: { business: ManagedBusiness; aside?: ReactNode }) {
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
  const tiles: { label: string; value: number; icon: LucideIcon; tone: string }[] = [
    { label: 'Still to come', value: counts.toCome, icon: Clock, tone: 'bg-sunken text-ink-2' },
    { label: 'Here now', value: counts.here, icon: UserCheck, tone: 'bg-brand-soft text-brand-ink' },
    { label: 'Done', value: counts.done, icon: CircleCheck, tone: 'bg-ok-soft text-ok' },
    { label: 'Didn’t come', value: counts.missed, icon: UserX, tone: 'bg-wait-soft text-wait-ink' },
  ];

  return (
    <section aria-labelledby="today" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* The date is in the page's header; the board says only what day it shows. */}
        <h2 id="today" className="type-heading">
          Today
          {date !== today && <span className="sr-only">, {longDate(date)}</span>}
        </h2>
        <Link
          href={`/business/${business.id}/appointments` as Route}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          All appointments
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      {day.isPending ? (
        <Skeleton className="h-28 rounded-2xl" />
      ) : (
        // One strip, not four boxes: the day reads left to right, to come → here → done.
        <dl className="grid grid-cols-2 overflow-hidden rounded-2xl bg-surface shadow-soft ring-1 ring-line sm:grid-cols-4">
          {tiles.map(({ label, value, icon: Icon, tone }, i) => (
            <div
              key={label}
              className={cn(
                'flex flex-col gap-2 p-4 sm:p-5',
                i % 2 === 1 && 'border-l border-line',
                i >= 2 && 'border-t border-line sm:border-t-0',
                i === 2 && 'sm:border-l',
              )}
            >
              <dt className="text-sm text-ink-2">{label}</dt>
              <dd className="flex items-center justify-between gap-3">
                <span className="tabular text-3xl font-semibold tracking-[-0.03em] text-ink">{value}</span>
                <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-xl', tone)}>
                  <Icon className="size-5" strokeWidth={1.9} />
                </span>
              </dd>
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

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="order-2 min-w-0 lg:order-1">
          {day.isPending ? (
            <Skeleton className="h-60 rounded-2xl" />
          ) : items.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="No bookings today">
              New bookings appear here by themselves, in time order.
            </EmptyState>
          ) : (
            <ol aria-label="Today’s visits" className="flex flex-col gap-3">
              {items.map((v, i) => (
                <Fragment key={v.id}>
                  {i === nowAt && <NowLine timezone={business.timezone} now={now} />}
                  <VisitRow
                    visit={v}
                    businessId={business.id}
                    role={business.myRole}
                    today={today}
                    now={now}
                  />
                </Fragment>
              ))}
              {nowAt === -1 && date === today && items.length > 0 && (
                <NowLine timezone={business.timezone} now={now} />
              )}
            </ol>
          )}
        </div>

        <aside
          aria-label="At the desk"
          className="order-1 flex flex-col gap-4 lg:sticky lg:top-20 lg:order-2"
        >
          <div className="rounded-2xl bg-brand-soft p-5">
            <CodeCheckIn businessId={business.id} />
            {next && (
              <p className="mt-4 border-t border-brand/15 pt-3 text-sm text-ink-2">
                Next: <span className="font-semibold text-ink">{next.customer.name}</span> at{' '}
                {next.local.startTime}
                {next.staff && <> with {next.staff.displayName}</>}.
              </p>
            )}
          </div>
          {aside}
        </aside>
      </div>
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

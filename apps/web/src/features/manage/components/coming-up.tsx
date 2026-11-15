'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import type { ManagedBusiness } from '../api';
import { dateIn, dayLabel, shiftDate } from '../visits';
import { fetchVisits, visitsKey } from '../visits-api';

/**
 * The week after today, beside the day (D-133): how many bookings are coming and the next few, so
 * a quiet day still says what's ahead. Cancelled and moved visits aren't counted.
 */
export function ComingUp({ business }: { business: ManagedBusiness }) {
  const today = dateIn(business.timezone);
  const query = { date: shiftDate(today, 1), days: 7 };
  const week = useQuery({
    queryKey: visitsKey(business.id, query),
    queryFn: () => fetchVisits(business.id, query),
    refetchInterval: 60_000,
  });
  const coming = (week.data?.items ?? []).filter((v) => v.status === 'pending' || v.status === 'confirmed');

  return (
    <section
      aria-labelledby="coming-up"
      className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-soft ring-1 ring-line"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="coming-up" className="text-base font-semibold">
          Coming up
        </h2>
        {week.isSuccess && (
          <span className="tabular text-sm text-ink-3">{coming.length} in the next 7 days</span>
        )}
      </div>
      {week.isPending ? (
        <Skeleton className="h-20" />
      ) : week.isError ? (
        <p className="text-sm text-ink-3">The week ahead isn’t loading right now.</p>
      ) : coming.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing booked yet. New bookings show here as they come in.</p>
      ) : (
        <ol aria-label="The next bookings" className="flex flex-col gap-2.5">
          {coming.slice(0, 4).map((v) => (
            <li key={v.id} className="flex items-start gap-3">
              <span className="tabular w-[4.5rem] shrink-0 pt-px text-xs font-medium text-ink-3">
                {dayLabel(v.local.date, today)}
                <span className="block text-sm font-semibold text-ink">{v.local.startTime}</span>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-ink">{v.customer.name}</span>
                <span className="truncate text-xs text-ink-3">
                  {v.service.name}
                  {v.staff && <> with {v.staff.displayName}</>}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <Link
        href={`/business/${business.id}/calendar` as Route}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
      >
        The week in the calendar
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </section>
  );
}

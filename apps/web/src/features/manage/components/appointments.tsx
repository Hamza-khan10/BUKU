'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarSearch, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { can, fetchManaged, fetchStaff, managedKey, staffKey } from '../api';
import {
  countDay,
  dateIn,
  dayLabel,
  longDate,
  shiftDate,
  STAGE_LABEL,
  type VisitQuery,
  type VisitStatus,
} from '../visits';
import { fetchVisits, visitsKey } from '../visits-api';
import { useNow } from './today';
import { VisitRow } from './visits';

const STATUSES: { value: VisitStatus; label: string }[] = [
  { value: 'pending', label: STAGE_LABEL.to_confirm },
  { value: 'confirmed', label: 'Booked or here' },
  { value: 'completed', label: STAGE_LABEL.done },
  { value: 'no_show', label: STAGE_LABEL.missed },
  { value: 'cancelled', label: STAGE_LABEL.cancelled },
  { value: 'rescheduled', label: STAGE_LABEL.moved },
];

/**
 * A business's appointments (3.5b): any day, one person's or everyone's, by status; or a search
 * by booking code or customer name (a month back to a year ahead). The choices live in the
 * address, so a view can be reloaded or shared with the team.
 */
export function Appointments({ id, query }: { id: string; query: VisitQuery }) {
  const router = useRouter();
  const now = useNow();
  const business = useQuery({ queryKey: managedKey(id), queryFn: () => fetchManaged(id) });
  const role = business.data?.myRole;
  const everyone = role ? can(role, 'appointments.manage_all') : false;
  const staff = useQuery({ queryKey: staffKey(id), queryFn: () => fetchStaff(id), enabled: everyone });
  const list = useQuery({
    queryKey: visitsKey(id, query),
    queryFn: () => fetchVisits(id, query),
    enabled: business.isSuccess,
    refetchInterval: 60_000,
  });
  const [text, setText] = useState(query.q ?? '');

  const today = business.data ? dateIn(business.data.timezone, new Date(now)) : (query.date ?? '');
  const date = query.q ? null : (list.data?.date ?? query.date ?? today);

  const go = (change: Partial<VisitQuery>) => {
    const next = { ...query, ...change };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, String(v));
    const qs = params.toString();
    router.replace(`/business/${id}/appointments${qs ? `?${qs}` : ''}` as Route, { scroll: false });
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    go({ q: text.trim() || undefined, date: undefined });
  };

  if (business.isError || list.isError) {
    const err = (business.error ?? list.error) as unknown;
    const e = err instanceof ApiError ? err : null;
    return (
      <ErrorState
        title="Appointments aren’t loading"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }

  const items = list.data?.items ?? [];
  const counts = countDay(items, now);

  return (
    <div className="flex flex-col gap-8">
      <PageHeading compact eyebrow={business.data?.name} title="Appointments" />

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line sm:p-5">
        <form onSubmit={search} role="search" className="flex flex-wrap gap-2">
          <label htmlFor="visit-search" className="sr-only">
            Find a booking by code or customer name
          </label>
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-ink-3"
            />
            <input
              id="visit-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Booking code or customer name"
              maxLength={100}
              autoComplete="off"
              className="h-11 w-full rounded-full bg-canvas pr-4 pl-11 text-[0.95rem] text-ink ring-1 ring-line placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-control focus-visible:outline-none"
            />
          </div>
          <Button type="submit">Find</Button>
          {query.q && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setText('');
                go({ q: undefined });
              }}
            >
              Back to the day
            </Button>
          )}
        </form>

        {!query.q && (
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Day" className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => go({ date: shiftDate(date ?? today, -1) })}>
                <ChevronLeft aria-hidden />
                <span className="sr-only">The day before</span>
              </Button>
              <label htmlFor="visit-date" className="sr-only">
                Day
              </label>
              <input
                id="visit-date"
                type="date"
                value={date ?? today}
                onChange={(e) => e.target.value && go({ date: e.target.value })}
                className="tabular h-11 rounded-full bg-canvas px-4 text-[0.95rem] text-ink ring-1 ring-line focus-visible:ring-2 focus-visible:ring-control focus-visible:outline-none"
              />
              <Button size="icon" variant="ghost" onClick={() => go({ date: shiftDate(date ?? today, 1) })}>
                <ChevronRight aria-hidden />
                <span className="sr-only">The day after</span>
              </Button>
              {date !== today && (
                <Button size="sm" variant="quiet" onClick={() => go({ date: undefined })}>
                  Today
                </Button>
              )}
            </nav>
            <div className="ml-auto flex flex-wrap gap-2">
              {everyone && (staff.data?.length ?? 0) > 1 && (
                <>
                  <label htmlFor="visit-staff" className="sr-only">
                    Whose appointments
                  </label>
                  <Select
                    id="visit-staff"
                    value={query.staffId ?? ''}
                    onChange={(e) => go({ staffId: e.target.value || undefined })}
                    className="h-11 w-auto rounded-full"
                  >
                    <option value="">Everyone</option>
                    {staff.data!.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              <label htmlFor="visit-status" className="sr-only">
                Which appointments
              </label>
              <Select
                id="visit-status"
                value={query.status ?? ''}
                onChange={(e) => go({ status: (e.target.value || undefined) as VisitStatus | undefined })}
                className="h-11 w-auto rounded-full"
              >
                <option value="">Every status</option>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </div>

      <section aria-labelledby="visits-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="visits-title" className="type-subheading">
            {query.q
              ? `Bookings matching “${query.q}”`
              : !today
                ? 'The day’s appointments'
                : date === today
                  ? `Today, ${longDate(today)}`
                  : longDate(date ?? today)}
          </h2>
          {list.isSuccess && items.length > 0 && (
            <p className="text-sm text-ink-2">
              {counts.booked} {counts.booked === 1 ? 'booking' : 'bookings'}
              {counts.toConfirm > 0 && <> · {counts.toConfirm} to confirm</>}
              {counts.cancelled > 0 && <> · {counts.cancelled} cancelled</>}
            </p>
          )}
        </div>
        {!business.isSuccess || list.isPending ? (
          <Skeleton className="h-48" />
        ) : items.length === 0 ? (
          <EmptyState icon={CalendarSearch} title={query.q ? 'No booking matches that' : 'No appointments'}>
            {query.q
              ? 'Codes look like BK-7KQ2MX; names match from a month back to a year ahead.'
              : date && date < today
                ? `Nothing was booked for ${dayLabel(date, today).toLowerCase() === 'yesterday' ? 'yesterday' : longDate(date)}.`
                : 'New bookings appear here by themselves.'}
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map((v) => (
              <VisitRow
                key={v.id}
                visit={v}
                businessId={id}
                role={business.data.myRole}
                today={today}
                now={now}
                showDate={Boolean(query.q)}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { can, fetchManaged, fetchStaff, managedKey, staffKey } from '../api';
import { hoursShown, layDay, minutesOf, weekDays, weekLabel, weekStart } from '../calendar';
import { dateIn, shiftDate, stageOf, STAGE_LABEL, type Stage, type Visit } from '../visits';
import { fetchVisits, visitsKey } from '../visits-api';
import { useNow } from './today';

/** One hour, in pixels: a 30-minute visit is a comfortable 32px. */
const HOUR = 64;

/** Each stage's colour on the calendar: the same meanings as everywhere else in the business area. */
const BLOCK: Record<Stage, string> = {
  to_confirm: 'bg-wait-soft text-ink border-l-wait',
  booked: 'bg-surface text-ink border-l-control',
  here: 'bg-brand-soft text-ink border-l-brand',
  done: 'bg-ok-soft text-ink-2 border-l-ok',
  missed: 'bg-danger-soft text-ink-2 border-l-danger',
  cancelled: 'bg-sunken text-ink-3 border-l-line line-through',
  moved: 'bg-sunken text-ink-3 border-l-line line-through',
};

const weekday = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(`${date}T12:00:00Z`),
  );
const dayNumber = (date: string) => Number(date.slice(8));
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * /business/[id]/calendar (3.5h): a week of appointments, everyone's or one person's, laid out by
 * the business's own clock. Cancelled and moved visits are left out (the appointments page has
 * them). Each visit opens on the appointments page, where the desk acts on it. The week and the
 * person live in the address, so a view can be shared with the team.
 */
export function CalendarPage({
  id,
  date,
  staffId,
}: {
  id: string;
  date?: string | undefined;
  staffId?: string | undefined;
}) {
  const router = useRouter();
  const now = useNow(60_000);
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const b = business.data;
  const role = b?.myRole;
  const everyone = role ? can(role, 'appointments.manage_all') : false;
  const today = b ? dateIn(b.timezone, new Date(now)) : null;
  const start = weekStart(date ?? today ?? new Date().toISOString().slice(0, 10));
  const staff = useQuery({ queryKey: staffKey(id), queryFn: () => fetchStaff(id), enabled: everyone });
  const query = { date: start, days: 7, staffId };
  const list = useQuery({
    queryKey: visitsKey(id, query),
    queryFn: () => fetchVisits(id, query),
    enabled: business.isSuccess,
    refetchInterval: 60_000,
  });

  const go = (change: { date?: string; staffId?: string | undefined }) => {
    const next = { date: change.date ?? start, staffId: 'staffId' in change ? change.staffId : staffId };
    const params = new URLSearchParams({ date: next.date });
    if (next.staffId) params.set('staffId', next.staffId);
    router.replace(`/business/${id}/calendar?${params}` as Route, { scroll: false });
  };

  const days = weekDays(start);
  const visits = useMemo(
    () => (list.data?.items ?? []).filter((v) => v.status !== 'cancelled' && v.status !== 'rescheduled'),
    [list.data],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Visit[]>(days.map((d) => [d, []]));
    for (const v of visits) map.get(v.local.date)?.push(v);
    return map;
  }, [visits, days]);
  const hours = hoursShown(visits);

  if (business.isError || list.isError) {
    const e =
      (business.error ?? list.error) instanceof ApiError
        ? ((business.error ?? list.error) as ApiError)
        : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this business' : 'We couldn’t load the calendar'}
        message={
          e?.status === 404 ? 'It may belong to another account.' : (e?.message ?? 'Please try again.')
        }
        reference={e?.requestId}
      />
    );
  }
  if (!b) return <Skeleton className="h-96" />;

  const nowMinutes = (() => {
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: b.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(now));
    return minutesOf(t);
  })();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        compact
        eyebrow={b.name}
        title="Calendar"
        description={
          everyone
            ? 'The week’s appointments, everyone’s or one person’s, by the business’s own clock.'
            : 'Your week’s appointments, by the business’s own clock.'
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous week"
            onClick={() => go({ date: shiftDate(start, -7) })}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => go({ date: weekStart(today ?? start) })}
            disabled={today !== null && weekStart(today) === start}
          >
            This week
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next week"
            onClick={() => go({ date: shiftDate(start, 7) })}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
          <h2 className="ml-2 text-lg font-semibold tracking-tight" aria-live="polite">
            {weekLabel(start)}
          </h2>
        </div>
        {everyone && (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            Whose
            <Select
              value={staffId ?? ''}
              onChange={(e) => go({ staffId: e.target.value || undefined })}
              className="h-10 w-auto min-w-44"
            >
              <option value="">Everyone</option>
              {(staff.data ?? [])
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
            </Select>
          </label>
        )}
      </div>

      <ul aria-label="What the colours mean" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-2">
        {(['to_confirm', 'booked', 'here', 'done', 'missed'] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-3 w-5 rounded-sm border border-line border-l-4 ${BLOCK[s]}`}
            />
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ul>

      {list.isPending ? (
        <Skeleton className="h-[32rem]" />
      ) : visits.length === 0 ? (
        <EmptyState title="Nothing booked this week">New bookings show here as they come in.</EmptyState>
      ) : (
        <>
          {/* Phones: the week as a list, day by day. */}
          <ol aria-label="This week, day by day" className="flex flex-col gap-5 md:hidden">
            {days.map((d) => {
              const items = byDay.get(d) ?? [];
              if (items.length === 0) return null;
              return (
                <li key={d} className="flex flex-col gap-2">
                  <h3 className={`text-sm font-semibold ${d === today ? 'text-brand-ink' : 'text-ink'}`}>
                    {weekday(d)} {dayNumber(d)}
                    {d === today && ' · today'}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {items.map((v) => (
                      <li key={v.id}>
                        <VisitLink id={id} visit={v} className="rounded-xl px-3 py-2.5" />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>

          {/* Wider screens: the week as a grid of hours. */}
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
            <div className="grid min-w-[52rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
              <div className="sticky top-0 z-10 border-b border-line bg-surface" />
              {days.map((d) => (
                <div
                  key={d}
                  className={`sticky top-0 z-10 flex items-baseline justify-center gap-1.5 border-b border-l border-line bg-surface px-2 py-2.5 text-sm ${
                    d === today ? 'text-brand-ink' : 'text-ink-2'
                  }`}
                >
                  <span>{weekday(d)}</span>
                  <span
                    className={`text-base font-semibold ${d === today ? 'rounded-md bg-brand px-1.5 text-on-brand' : 'text-ink'}`}
                  >
                    {dayNumber(d)}
                  </span>
                  {(byDay.get(d)?.length ?? 0) > 0 && (
                    <span className="text-xs text-ink-3">· {byDay.get(d)!.length}</span>
                  )}
                </div>
              ))}

              <div className="relative" style={{ height: (hours.to - hours.from) * HOUR }}>
                {Array.from({ length: hours.to - hours.from }, (_, i) => (
                  <span
                    key={i}
                    className="absolute right-2 -translate-y-1/2 text-[0.7rem] text-ink-3 tabular-nums"
                    style={{ top: i * HOUR }}
                  >
                    {i === 0 ? '' : hourLabel(hours.from + i)}
                  </span>
                ))}
              </div>
              {days.map((d) => (
                <section
                  key={d}
                  aria-label={`${weekday(d)} ${dayNumber(d)}`}
                  className="relative border-l border-line"
                  style={{
                    height: (hours.to - hours.from) * HOUR,
                    backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${HOUR}px)`,
                  }}
                >
                  {layDay(byDay.get(d) ?? [], hours.from).map((p) => (
                    <div
                      key={p.visit.id}
                      className="absolute p-0.5"
                      style={{
                        top: (p.top / 60) * HOUR,
                        height: Math.max(22, (p.height / 60) * HOUR),
                        left: `${(p.lane / p.lanes) * 100}%`,
                        width: `${100 / p.lanes}%`,
                      }}
                    >
                      <VisitLink
                        id={id}
                        visit={p.visit}
                        compact={p.height < 45}
                        className="h-full rounded-lg px-2 py-1"
                      />
                    </div>
                  ))}
                  {d === today && nowMinutes >= hours.from * 60 && nowMinutes <= hours.to * 60 && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-[1] h-0.5 bg-danger"
                      style={{ top: ((nowMinutes - hours.from * 60) / 60) * HOUR }}
                    >
                      <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
                    </span>
                  )}
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One visit, in its stage's colour; opens it on the appointments page (found by its code). */
function VisitLink({
  id,
  visit: v,
  compact = false,
  className,
}: {
  id: string;
  visit: Visit;
  compact?: boolean;
  className?: string;
}) {
  const stage = stageOf(v);
  return (
    <Link
      href={`/business/${id}/appointments?q=${encodeURIComponent(v.code)}` as Route}
      className={`flex flex-col overflow-hidden border border-line border-l-4 text-left text-xs leading-tight transition-shadow hover:shadow-md focus-visible:z-10 ${BLOCK[stage]} ${className ?? ''}`}
    >
      <span className="sr-only">{STAGE_LABEL[stage]}: </span>
      {compact ? (
        // Too short for two lines: everything on one, the start time first.
        <span className="truncate">
          <span className="font-semibold text-ink">
            {v.local.startTime} {v.service.name}
          </span>{' '}
          · {v.customer.name}
        </span>
      ) : (
        <>
          <span className="truncate font-semibold text-ink">
            {v.local.startTime}–{v.local.endTime} {v.service.name}
          </span>
          <span className="truncate">
            {v.customer.name}
            {v.staff && ` · ${v.staff.displayName}`}
          </span>
        </>
      )}
    </Link>
  );
}

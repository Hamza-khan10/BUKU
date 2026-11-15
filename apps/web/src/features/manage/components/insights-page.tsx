'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Card, CardBody, CardDescription, CardHeader } from '@/components/ui/card';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { can, fetchManaged, managedKey } from '../api';
import {
  everyWeek,
  hourLabel,
  hoursInOrder,
  percent,
  PERIODS,
  periodDates,
  REASON_LABEL,
  shortDate,
  weekdaysInOrder,
  type Breakdown,
  type CancellationReport,
  type Period,
} from '../insights';
import { fetchInsights, insightsKey } from '../insights-api';
import { dateIn } from '../visits';
import {
  DataTable,
  Legend,
  NumbersTable,
  RankedBars,
  StackedColumns,
  StatTile,
  type Column,
  type Series,
} from './insight-charts';

/** What happened to a visit: it happened, the customer didn't come, or the customer cancelled. */
const CAME: Series = { key: 'came', label: 'Came', color: 'var(--series-kept)' };
const MISSED: Series = { key: 'missed', label: 'Didn’t come', color: 'var(--series-missed)' };
const CANCELLED: Series = { key: 'cancelled', label: 'Cancelled', color: 'var(--series-cancelled)' };

/** Labels under every column, or every few where they would crowd (about five). */
const labelEvery = (count: number) => Math.max(1, Math.ceil(count / 5));

/**
 * /business/[id]/insights (3.5j): cancellations and no-shows for the owner and managers. How many,
 * why, when (by the business's own clock), for which services and people, and whether "remind me
 * later" brought customers back. Counted by the day each visit was for; the period ends today.
 */
export function InsightsPage({ id, days }: { id: string; days: Period }) {
  const router = useRouter();
  const business = useQuery({ queryKey: managedKey(id), queryFn: () => fetchManaged(id) });
  const allowed = business.data ? can(business.data.myRole, 'reports.view') : false;
  const range = business.data ? periodDates(days, dateIn(business.data.timezone)) : null;
  const report = useQuery({
    queryKey: insightsKey(id, range?.from ?? '', range?.to ?? ''),
    queryFn: () => fetchInsights(id, range!.from, range!.to),
    enabled: allowed && range !== null,
    placeholderData: keepPreviousData,
  });

  if (business.isError || report.isError) {
    const err = business.error ?? report.error;
    const e = err instanceof ApiError ? err : null;
    return (
      <ErrorState
        title="We couldn’t load the insights"
        message={e?.message ?? 'Please try again.'}
        reference={e?.requestId}
      />
    );
  }
  if (!business.data) return <Skeleton className="h-96 max-w-5xl" />;
  if (!allowed)
    return (
      <EmptyState title="Insights are for the owner and managers">
        Ask them how the business is doing.
      </EmptyState>
    );

  const choose = (d: Period) =>
    router.replace(`/business/${id}/insights${d === 90 ? '' : `?days=${d}`}` as Route, { scroll: false });

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <PageHeading
        compact
        eyebrow={business.data.name}
        title="Insights"
        description="Cancellations and no-shows: how many, why and when. Each visit counts on the day it was for."
      />
      <div role="group" aria-label="Period" className="inline-flex w-fit gap-1 rounded-xl bg-sunken p-1">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            type="button"
            aria-pressed={days === p.days}
            onClick={() => choose(p.days)}
            className={cn(
              'h-9 rounded-lg px-3 text-sm font-medium transition-colors',
              days === p.days ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {report.isPending ? (
        <Skeleton className="h-[32rem]" />
      ) : report.data.totals.booked === 0 ? (
        <EmptyState title="Nothing booked in these days">
          Insights fill in as customers book. Try a longer period.
        </EmptyState>
      ) : (
        // While another period loads, the last one stays, dimmed: no jump, no flash.
        <div
          aria-busy={report.isPlaceholderData}
          className={cn('flex flex-col gap-6 transition-opacity', report.isPlaceholderData && 'opacity-60')}
        >
          <Report report={report.data} />
        </div>
      )}
    </div>
  );
}

function Report({ report: r }: { report: CancellationReport }) {
  const t = r.totals;
  const due = t.completed + t.noShows;
  const weeks = everyWeek(r.weekly, r.period.from, r.period.to);
  const weekStep = labelEvery(weeks.length);
  const weekColumns: Column[] = weeks.map((w, i) => ({
    key: w.weekOf,
    axis: i % weekStep === 0 ? shortDate(w.weekOf) : null,
    title: `Week of ${shortDate(w.weekOf, true)}`,
    values: { came: w.completed, missed: w.noShows, cancelled: w.cancellations },
    note: `${w.booked} booked`,
  }));
  const weekdays = weekdaysInOrder(r.byWeekday);
  const hours = hoursInOrder(r.byHour);
  const hourStep = labelEvery(hours.length);

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Bookings"
          value={t.booked.toLocaleString('en-GB')}
          detail={`${t.completed} came${t.upcoming ? `, ${t.upcoming} still to come` : ''}`}
        />
        <StatTile
          label="Cancelled by customers"
          value={percent(r.rates.customerCancellation)}
          detail={`${t.cancelledByCustomer} ${t.cancelledByCustomer === 1 ? 'visit' : 'visits'}, ${t.lateCancellations} late`}
        />
        <StatTile
          label="Didn’t come"
          value={percent(r.rates.noShow)}
          detail={
            due
              ? `${t.noShows} of ${due} ${due === 1 ? 'visit that was' : 'visits that were'} due`
              : 'No visit was due yet'
          }
        />
        <StatTile
          label="Booked again"
          value={percent(r.rebookLater.rate)}
          detail={
            r.rebookLater.asked
              ? `${r.rebookLater.bookedAgain} of ${r.rebookLater.asked} who asked for a reminder`
              : 'No one asked for a reminder yet'
          }
        />
      </dl>

      <ChartCard
        title="Week by week"
        description="What happened to each week’s visits. Hover or focus a week for its numbers."
      >
        <Legend series={[CAME, MISSED, CANCELLED]} />
        <StackedColumns label="Week by week" series={[CAME, MISSED, CANCELLED]} columns={weekColumns} />
        <NumbersTable
          caption="Week by week"
          headers={['Week of', 'Booked', 'Came', 'Didn’t come', 'Cancelled']}
          rows={weeks.map((w) => ({
            key: w.weekOf,
            cells: [shortDate(w.weekOf, true), w.booked, w.completed, w.noShows, w.cancellations],
          }))}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Why customers cancelled" description="The reason each customer chose.">
          {r.reasons.length ? (
            <RankedBars
              label="Why customers cancelled"
              color={CANCELLED.color}
              rows={r.reasons.map((x) => ({ key: x.reason, label: REASON_LABEL[x.reason], value: x.count }))}
            />
          ) : (
            <p className="text-sm text-ink-3">No customer cancelled in these days.</p>
          )}
        </ChartCard>
        <ChartCard title="Everything else" description="The rest of the period’s bookings.">
          <dl className="flex flex-col text-sm">
            <Line term="Cancelled late (inside your notice time)" value={t.lateCancellations} />
            <Line term="Cancelled by you" value={t.cancelledByBusiness} />
            <Line term="Requests you declined" value={t.declined} />
            <Line term="Cancelled automatically" value={t.cancelledBySystem} />
            <Line term="Moved to another time" value={t.moved} />
            <Line term="Still to come" value={t.upcoming} />
          </dl>
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Which days" description="Cancellations and no-shows by the day the visit was for.">
          <Legend series={[MISSED, CANCELLED]} />
          <StackedColumns
            label="Which days"
            series={[MISSED, CANCELLED]}
            columns={weekdays.map((d) => ({
              key: String(d.day),
              axis: d.name.slice(0, 3),
              title: d.name,
              values: { missed: d.noShows, cancelled: d.cancellations },
            }))}
          />
          <NumbersTable
            caption="Which days"
            headers={['Day', 'Didn’t come', 'Cancelled']}
            rows={weekdays.map((d) => ({ key: String(d.day), cells: [d.name, d.noShows, d.cancellations] }))}
          />
        </ChartCard>
        <ChartCard title="Which times" description="By the hour the visit was to start, on your clock.">
          <Legend series={[MISSED, CANCELLED]} />
          <StackedColumns
            label="Which times"
            series={[MISSED, CANCELLED]}
            columns={hours.map((h, i) => ({
              key: String(h.hour),
              axis: i % hourStep === 0 ? hourLabel(h.hour) : null,
              title: `${hourLabel(h.hour)} to ${hourLabel((h.hour + 1) % 24)}`,
              values: { missed: h.noShows, cancelled: h.cancellations },
            }))}
          />
          <NumbersTable
            caption="Which times"
            headers={['Starting', 'Didn’t come', 'Cancelled']}
            rows={hours.map((h) => ({
              key: String(h.hour),
              cells: [hourLabel(h.hour), h.noShows, h.cancellations],
            }))}
          />
        </ChartCard>
      </div>

      <ChartCard title="By service" description="The 20 most booked.">
        <BreakdownTable caption="By service" first="Service" rows={r.byService} />
      </ChartCard>
      {r.byStaff.length > 0 && (
        <ChartCard title="By person" description="Who the visit was with.">
          <BreakdownTable caption="By person" first="Person" rows={r.byStaff} />
        </ChartCard>
      )}
    </>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold tracking-[-0.015em]">{title}</h2>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">{children}</CardBody>
    </Card>
  );
}

function Line({ term, value }: { term: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="text-ink-2">{term}</dt>
      <dd className="font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function BreakdownTable({ caption, first, rows }: { caption: string; first: string; rows: Breakdown[] }) {
  return (
    <DataTable
      caption={caption}
      headers={[first, 'Booked', 'Didn’t come', 'Cancelled', 'Cancellation rate']}
      rows={rows.map((s) => ({
        key: s.id,
        cells: [s.name, s.booked, s.noShows, s.cancellations, percent(s.cancellationRate)],
      }))}
    />
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, CircleDashed, ListOrdered, ScanLine } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import {
  canSetUp,
  fetchManaged,
  fetchMenu,
  fetchStaff,
  managedKey,
  menuKey,
  staffKey,
  type ManagedBusiness,
} from '../api';
import { dateIn, longDate } from '../visits';
import { ComingUp } from './coming-up';
import { STATUS, StatusBadge } from './status';
import { TodayBoard } from './today';

/**
 * A business's home in its workspace (3.5a–b, redrawn in D-133): the business and its day at a
 * glance, with what the desk reaches for first (checking someone in, the queue). Until people can
 * book, what's left to set up comes first; once they can, today does.
 */
export function BusinessHome({ id }: { id: string }) {
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const ok = business.isSuccess;
  const menu = useQuery({ queryKey: menuKey(id), queryFn: () => fetchMenu(id), enabled: ok });
  const staff = useQuery({ queryKey: staffKey(id), queryFn: () => fetchStaff(id), enabled: ok });

  if (business.isError) {
    const e = business.error instanceof ApiError ? business.error : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this business' : 'We couldn’t load this business'}
        message={
          e?.status === 404 ? 'It may belong to another account.' : (e?.message ?? 'Please try again.')
        }
        reference={e?.requestId}
      />
    );
  }
  if (business.isPending)
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton className="h-20 max-w-xl" />
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );

  const b = business.data;
  const services = menu.data?.categories.flatMap((c) => c.services) ?? [];
  const working = (staff.data ?? []).filter((s) => s.isActive !== false && s.serviceIds.length > 0);
  const steps = [
    { done: b.hours.length > 0, label: 'Opening hours', detail: 'When people can come.' },
    {
      done: services.length > 0,
      label: 'A service',
      detail: services.length > 0 ? `${services.length} on your menu.` : 'What people book.',
    },
    {
      done: working.length > 0,
      label: 'Someone who does it',
      detail:
        working.length > 0
          ? working.map((s) => s.displayName).join(', ')
          : 'Their hours make the free times.',
    },
  ];
  const loaded = menu.isSuccess && staff.isSuccess;
  const ready = loaded && steps.every((s) => s.done);
  const setup = <Setup business={b} steps={steps} loaded={loaded} ready={ready} />;

  return (
    <>
      <Header business={b} />
      {b.status === 'rejected' && b.rejectionReason && (
        <Alert tone="danger" title="BUKU couldn’t approve it">
          {b.rejectionReason} {STATUS[b.status].text}
        </Alert>
      )}
      {!ready && setup}
      {loaded && ready && (
        <TodayBoard
          business={b}
          aside={
            <>
              <ComingUp business={b} />
              {setup}
            </>
          }
        />
      )}
    </>
  );
}

function Header({ business: b }: { business: ManagedBusiness }) {
  const status = STATUS[b.status];
  const today = longDate(dateIn(b.timezone));
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-medium text-ink-3">{today}</p>
        <h1 className="type-app-title truncate">{b.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
          <span>
            {b.category.name}, {b.address.city}
          </span>
          <StatusBadge status={b.status} />
          {status.public && (
            <Link
              href={`/b/${b.slug}` as Route}
              className="inline-flex items-center gap-1 font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              See your page
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          )}
        </div>
        {b.status !== 'verified' && b.status !== 'rejected' && (
          <p className="max-w-2xl text-sm text-ink-3">{status.text}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href={`/business/${b.id}/check-in` as Route}>
            <ScanLine aria-hidden className="size-4" />
            Check someone in
          </Link>
        </Button>
        <Button asChild variant="primary">
          <Link href={`/business/${b.id}/queue` as Route}>
            <ListOrdered aria-hidden className="size-4" />
            The queue
          </Link>
        </Button>
      </div>
    </header>
  );
}

/** What it takes before people can book: hours, a service, and someone who does it. */
function Setup({
  business: b,
  steps,
  loaded,
  ready,
}: {
  business: ManagedBusiness;
  steps: { done: boolean; label: string; detail: string }[];
  loaded: boolean;
  ready: boolean;
}) {
  return (
    <section
      aria-labelledby="setup"
      className={cn(
        'flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-soft ring-1 ring-line',
        !ready && 'max-w-3xl sm:p-6',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup" className={ready ? 'text-base font-semibold' : 'type-subheading'}>
          {ready ? 'Ready for bookings' : 'Before people can book'}
        </h2>
        {loaded && (
          <span className="tabular text-sm text-ink-3">
            {steps.filter((s) => s.done).length} of {steps.length} done
          </span>
        )}
      </div>
      {loaded ? (
        <ol className={cn('flex flex-col', ready ? 'gap-2' : 'gap-3')}>
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
                  s.done ? 'bg-ok text-surface' : 'text-ink-3',
                )}
              >
                {s.done ? (
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                ) : (
                  <CircleDashed className="size-5" aria-hidden />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-ink">
                  {s.label}
                  <span className="sr-only">{s.done ? ' (done)' : ' (still to do)'}</span>
                </span>
                <span className="truncate text-sm text-ink-3">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <Skeleton className="h-24" />
      )}
      {loaded && !ready && canSetUp(b.myRole) && (
        <div>
          <Button asChild variant="primary">
            <Link href={`/business/${b.id}/setup` as Route}>Finish setting up</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

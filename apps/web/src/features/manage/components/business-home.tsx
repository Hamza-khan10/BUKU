'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, CircleDashed } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/layout';
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
  ROLE_LABELS,
  staffKey,
} from '../api';
import { BusinessPictures } from './business-pictures';
import { STATUS, StatusBadge } from './status';
import { TodayBoard } from './today';

/**
 * A business's own page: where it stands with BUKU (3.5a) and today at the front desk (3.5b).
 * Until people can book, what's left to set up comes first; once they can, today does. The
 * queue board joins it next (3.5c).
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
  if (business.isPending) return <Skeleton className="h-72 max-w-3xl" />;

  const b = business.data;
  const status = STATUS[b.status];
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

  const setup = (
    <section
      aria-labelledby="setup"
      className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup" className="type-subheading">
          {ready ? 'Ready for bookings' : 'Before people can book'}
        </h2>
        {loaded && (
          <span className="tabular text-sm text-ink-3">
            {steps.filter((s) => s.done).length} of {steps.length} done
          </span>
        )}
      </div>
      {loaded ? (
        <ol className="flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
                  s.done ? 'bg-ok text-surface' : 'text-ink-3',
                )}
              >
                {s.done ? (
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                ) : (
                  <CircleDashed className="size-5" aria-hidden />
                )}
              </span>
              <span className="flex flex-col">
                <span className="font-medium text-ink">
                  {s.label}
                  <span className="sr-only">{s.done ? ' (done)' : ' (still to do)'}</span>
                </span>
                <span className="text-sm text-ink-3">{s.detail}</span>
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

  return (
    <div className="flex max-w-5xl flex-col gap-10">
      <PageHeading
        compact
        eyebrow={ROLE_LABELS[b.myRole]}
        title={b.name}
        description={`${b.category.name} · ${b.address.city}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={b.status} />
          {status.public && (
            <Link
              href={`/b/${b.slug}` as Route}
              className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              See your page
            </Link>
          )}
        </div>
      </PageHeading>

      {b.status === 'rejected' && b.rejectionReason ? (
        <Alert tone="danger" title="BUKU couldn’t approve it">
          {b.rejectionReason} {status.text}
        </Alert>
      ) : (
        <p className="text-ink-2">{status.text}</p>
      )}

      {!ready && setup}
      {loaded && ready && <TodayBoard business={b} />}
      {ready && setup}

      {canSetUp(b.myRole) && (
        <section
          aria-labelledby="looks"
          className="flex flex-col gap-5 rounded-xl bg-surface p-5 shadow-soft ring-1 ring-line sm:p-6"
        >
          <h2 id="looks" className="type-subheading">
            How it looks
          </h2>
          <BusinessPictures business={b} />
        </section>
      )}

      <p className="text-sm text-ink-3">Your queue board comes to this page next.</p>
    </div>
  );
}

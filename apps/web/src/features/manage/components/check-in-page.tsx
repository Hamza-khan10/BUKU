'use client';

import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { fetchManaged, managedKey } from '../api';
import { actionsFor, dateIn } from '../visits';
import { fetchVisits, visitsKey } from '../visits-api';
import { CodeCheckIn } from './check-in';
import { useNow } from './today';
import { VisitRow } from './visits';

/**
 * The front desk's check-in (3.5b): the code from the receipt, typed or scanned, and the people
 * expected now (check-in is open from two hours before), to check in by name someone who has no
 * phone with them.
 */
export function CheckInPage({ id }: { id: string }) {
  const now = useNow();
  const business = useQuery({ queryKey: managedKey(id), queryFn: () => fetchManaged(id) });
  const day = useQuery({
    queryKey: visitsKey(id),
    queryFn: () => fetchVisits(id),
    enabled: business.isSuccess,
    refetchInterval: 30_000,
  });

  if (business.isError || day.isError) {
    const err = (business.error ?? day.error) as unknown;
    const e = err instanceof ApiError ? err : null;
    return (
      <ErrorState
        title="Check-in isn’t loading"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }

  const b = business.data;
  const expected = b
    ? (day.data?.items ?? []).filter((v) => actionsFor(v, b.myRole, now).includes('check_in'))
    : [];

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <PageHeading
        compact
        eyebrow={b?.name}
        title="Check someone in"
        description="Type the code from their receipt, or scan its QR code."
      />
      <div className="rounded-2xl bg-brand-soft p-5 sm:p-7">
        <CodeCheckIn businessId={id} large scan />
      </div>
      <section aria-labelledby="expected" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="expected" className="type-subheading">
            Expected now
          </h2>
          <p className="text-sm text-ink-2">No phone with them? Check them in by name.</p>
        </div>
        {!b || day.isPending ? (
          <Skeleton className="h-32" />
        ) : expected.length === 0 ? (
          <EmptyState icon={Users} title="Nobody expected right now">
            People show here from two hours before their time.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {expected.map((v) => (
              <VisitRow
                key={v.id}
                visit={v}
                businessId={id}
                role={b.myRole}
                today={dateIn(b.timezone, new Date(now))}
                now={now}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

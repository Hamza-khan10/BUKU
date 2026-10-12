'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api/errors';
import { can, fetchManaged, managedKey, type ManagedBusiness } from '../api';
import { LoginsSection } from './logins';
import { PeopleSection } from './people';
import { ServicesManager } from './services-manager';

/** A business page that needs the business loaded and a permission; says so plainly otherwise. */
function WithBusiness({
  id,
  permission,
  children,
}: {
  id: string;
  permission: 'services.manage' | 'staff.manage';
  children: (business: ManagedBusiness) => ReactNode;
}) {
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (business.isPending) return <Skeleton className="h-80 max-w-3xl" />;
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
  if (!can(business.data.myRole, permission)) {
    return (
      <p className="max-w-xl text-ink-2">
        Only the owner or a manager can change this.{' '}
        <Link
          href={`/business/${id}` as Route}
          className="font-medium text-brand-ink underline underline-offset-4"
        >
          Back to {business.data.name}
        </Link>
      </p>
    );
  }
  return <>{children(business.data)}</>;
}

/** /business/[id]/services: the menu. */
export function ServicesPage({ id }: { id: string }) {
  return (
    <WithBusiness id={id} permission="services.manage">
      {(b) => (
        <div className="flex max-w-3xl flex-col gap-8">
          <PageHeading
            compact
            eyebrow={b.name}
            title="Services"
            description="What people can book: how long each takes, its price, and who does it."
          />
          <ServicesManager business={b} />
        </div>
      )}
    </WithBusiness>
  );
}

/** /business/[id]/team: the people customers can book, and the team's logins. */
export function TeamPage({ id }: { id: string }) {
  return (
    <WithBusiness id={id} permission="staff.manage">
      {(b) => (
        <div className="flex max-w-3xl flex-col gap-10">
          <PageHeading
            compact
            eyebrow={b.name}
            title="Team"
            description="Who customers can book, when they work, and who signs in to BUKU at work."
          />
          <section aria-labelledby="people" className="flex flex-col gap-4">
            <h2 id="people" className="type-heading">
              People customers can book
            </h2>
            <PeopleSection business={b} />
          </section>
          {can(b.myRole, 'members.manage') && (
            <section aria-labelledby="logins" className="flex flex-col gap-4">
              <h2 id="logins" className="type-heading">
                Logins
              </h2>
              <LoginsSection business={b} />
            </section>
          )}
        </div>
      )}
    </WithBusiness>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Store } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ME_KEY, fetchMe } from '@/features/auth/api';
import { CategoryIcon } from '@/features/categories/icons';
import { ApiError } from '@/lib/api/errors';
import { fetchMine, MINE_KEY, ROLE_LABELS } from '../api';
import { StatusBadge } from './status';

/**
 * The businesses this account owns or works at, each with where it stands, and a way to add
 * one. Team (employee) accounts belong to their business and can't add another.
 */
export function MyBusinesses() {
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: fetchMine });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const canAdd = me.data?.account.type === 'personal';

  if (mine.isPending || me.isPending) return <Skeleton className="h-48 max-w-3xl" />;
  if (mine.isError) {
    const e = mine.error instanceof ApiError ? mine.error : null;
    return (
      <ErrorState
        title="We couldn’t load your businesses"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }

  if (mine.data.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title="No business here yet"
        action={
          canAdd ? (
            <Button asChild variant="primary">
              <Link href="/business/new">Add your business</Link>
            </Button>
          ) : undefined
        }
      >
        Add yours in about five minutes: what it is, where it is, your opening hours and a first service. Your
        page goes live as soon as you finish.
      </EmptyState>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <ul className="flex flex-col gap-3">
        {mine.data.map((b) => (
          <li key={b.id}>
            <Link
              href={`/business/${b.id}` as Route}
              className="group flex items-center gap-4 rounded-xl bg-surface p-4 shadow-soft ring-1 ring-line transition-[box-shadow,transform] duration-300 ease-(--ease-out) hover:ring-control active:scale-[0.99] sm:p-5"
            >
              <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-soft text-brand-ink">
                {b.logoUrl ? (
                  <img src={b.logoUrl} alt="" className="size-full object-cover" />
                ) : (
                  <CategoryIcon slug={b.category.slug} className="size-6" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">
                  {b.name}
                </span>
                <span className="truncate text-sm text-ink-3">
                  {b.category.name} · {b.address.city} · {ROLE_LABELS[b.myRole]}
                </span>
                <span>
                  <StatusBadge status={b.status} />
                </span>
              </span>
              <ChevronRight
                className="size-5 shrink-0 text-ink-3 transition-transform duration-300 ease-(--ease-out) group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
      {canAdd && (
        <div>
          <Button asChild>
            <Link href="/business/new">Add another business</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

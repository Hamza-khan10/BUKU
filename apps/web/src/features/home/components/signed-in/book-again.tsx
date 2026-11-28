'use client';

import { useQuery } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { bookAgain } from '@/features/booking/again';
import { fetchVisits } from '@/features/booking/api';
import { bookHref } from '@/features/booking/choices';

/**
 * The places someone has been, each service once, to book the same again in one tap. Shown only
 * once there's a visit to repeat: a first-timer's home has the places near them instead.
 */
export function BookAgain() {
  const past = useQuery({ queryKey: ['visits', 'past', 'home'], queryFn: () => fetchVisits('past', 1, 20) });
  const again = bookAgain(past.data?.items ?? []).slice(0, 4);
  if (again.length === 0) return null;
  return (
    <section aria-labelledby="book-again" className="flex flex-col gap-4">
      <h2 id="book-again" className="type-heading">
        Book again
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {again.map((r) => (
          <li key={`${r.business.id}:${r.service.id}`}>
            <Link
              href={bookHref(r.business.slug, { serviceId: r.service.id }) as Route}
              className="flex h-full items-center gap-3 rounded-xl bg-surface p-3.5 ring-1 ring-line transition-[box-shadow] duration-300 hover:ring-control"
            >
              <Repeat className="size-5 shrink-0 text-ink-3" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-ink">{r.service.name}</span>
                <span className="truncate text-sm text-ink-3">{r.business.name}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

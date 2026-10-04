'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Repeat, ShieldCheck, Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { Ticket } from '@/components/ui/ticket';
import { fetchMe, ME_KEY } from '@/features/auth/api';
import { fetchReliability, fetchVisits, RELIABILITY_KEY } from '@/features/booking/api';
import { bookHref, clockLabel, dayParts } from '@/features/booking/choices';
import type { Receipt } from '@/features/booking/types';
import { useMinute } from '@/features/booking/notice';
import { fetchMyTicket, MY_TICKET_KEY } from '@/features/queue/api';
import { fetchMyReviews, MY_REVIEWS_KEY } from '@/features/reviews/api';
import { reviewable } from '@/features/reviews/rules';

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Services people actually went for, newest first, each place and service once. */
function bookAgain(past: Receipt[]): Receipt[] {
  const seen = new Set<string>();
  return past.filter((r) => {
    const key = `${r.business.id}:${r.service.id}`;
    const went = r.status === 'completed' || r.checkedInAt !== null;
    if (!went || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The account's front page: the next visit as its ticket (what most people
 * come here for), how reliably they keep bookings — with exactly what
 * businesses see — and the places they've been, to book again in one tap.
 */
export function AccountHome() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const upcoming = useQuery({
    queryKey: ['visits', 'upcoming', 'home'],
    queryFn: () => fetchVisits('upcoming', 1, 3),
  });
  const past = useQuery({ queryKey: ['visits', 'past', 'home'], queryFn: () => fetchVisits('past', 1, 20) });
  const reliability = useQuery({ queryKey: RELIABILITY_KEY, queryFn: fetchReliability });
  const queueTicket = useQuery({ queryKey: MY_TICKET_KEY, queryFn: fetchMyTicket });
  const reviews = useQuery({ queryKey: MY_REVIEWS_KEY, queryFn: () => fetchMyReviews() });
  const minute = useMinute();
  // Visits that happened in the last 30 days and haven't been reviewed yet.
  const toReview =
    minute === null || !reviews.data
      ? []
      : (past.data?.items ?? [])
          .filter((v) => reviewable(v, minute) && !reviews.data.items.some((x) => x.appointmentId === v.id))
          .slice(0, 3);

  const first = me.data?.name.split(' ')[0];
  const next = upcoming.data?.items[0];
  const again = bookAgain(past.data?.items ?? []).slice(0, 4);

  return (
    <div className="flex flex-col gap-12">
      <h1 className="font-display text-4xl font-bold tracking-tight">
        {first ? `Hi, ${first}` : 'Your account'}
      </h1>

      {queueTicket.data && (
        <Section title="Your place in a queue">
          <Link
            href={`/queue/${queueTicket.data.id}` as Route}
            className="flex max-w-xl items-center gap-4 rounded-lg border border-wait/40 bg-wait-soft p-4 hover:border-wait"
          >
            <span className="font-mono text-2xl font-bold text-ink">{queueTicket.data.ticket}</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-ink">{queueTicket.data.business.name}</span>
              <span className="text-sm text-ink-2">
                {queueTicket.data.status === 'called'
                  ? 'It’s your turn — open your ticket'
                  : queueTicket.data.status === 'serving'
                    ? 'You’re being served'
                    : queueTicket.data.ahead === 0
                      ? 'You’re next — open your ticket'
                      : `${queueTicket.data.ahead ?? '…'} ahead of you — open your ticket`}
              </span>
            </span>
          </Link>
        </Section>
      )}

      <Section
        title="Your next visit"
        action={
          upcoming.data && upcoming.data.meta.total > 0 ? (
            <Link
              href="/account/appointments"
              className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              All {upcoming.data.meta.total} upcoming
            </Link>
          ) : undefined
        }
      >
        {upcoming.isPending ? (
          <Skeleton className="h-56 max-w-xl" />
        ) : next ? (
          <div className="flex flex-col gap-3">
            <Ticket
              status={
                next.status === 'pending'
                  ? { label: 'Waiting for the business to confirm', tone: 'wait', live: true }
                  : { label: 'Confirmed', tone: 'ok' }
              }
              place={next.business.name}
              title={`${next.service.name}${next.staff ? ` with ${next.staff.displayName}` : ''}`}
              when={`${dayParts(next.local.date).label}, ${clockLabel(next.local.startTime)}`}
              details={
                <span>
                  {next.business.address.line}, {next.business.address.city}
                </span>
              }
              code={next.code}
              codeLabel="Booking code"
              qr
            />
            <Link
              href={`/appointments/${next.id}` as Route}
              className="w-fit text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              Open this booking — move it, cancel it, add it to your calendar
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="Nothing booked"
            action={
              <Button asChild variant="primary">
                <Link href="/explore">Find a place</Link>
              </Button>
            }
          >
            Book a visit and its ticket shows up here.
          </EmptyState>
        )}
      </Section>

      {toReview.length > 0 && (
        <Section title="How did it go?">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {toReview.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/appointments/${v.id}/review` as Route}
                  className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 hover:border-ink-3"
                >
                  <Star className="size-5 shrink-0 text-wait" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-ink">Review {v.business.name}</span>
                    <span className="truncate text-sm text-ink-2">
                      {v.service.name}, {dayParts(v.local.date).label}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="How reliably you keep bookings">
        {reliability.isPending ? (
          <Skeleton className="h-32 max-w-xl" />
        ) : reliability.data ? (
          <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <p className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
              <ShieldCheck className="size-6 text-ok" aria-hidden /> {reliability.data.label}
            </p>
            <p className="text-sm text-ink-2">
              Businesses see only this:{' '}
              <span className="font-medium text-ink">“{reliability.data.businessesSee}”</span> — never your
              history.
            </p>
            <p className="text-sm text-ink-3">
              The last 12 months: {reliability.data.visits}{' '}
              {reliability.data.visits === 1 ? 'visit' : 'visits'}, {reliability.data.noShows} missed,{' '}
              {reliability.data.lateCancellations} late{' '}
              {reliability.data.lateCancellations === 1 ? 'cancellation' : 'cancellations'}.
            </p>
            <p className="text-sm text-ink-2">{reliability.data.tip}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-2">We couldn’t load this just now.</p>
        )}
      </Section>

      {again.length > 0 && (
        <Section title="Book again">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {again.map((r) => (
              <li key={`${r.business.id}:${r.service.id}`}>
                <Link
                  href={bookHref(r.business.slug, { serviceId: r.service.id }) as Route}
                  className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 hover:border-ink-3"
                >
                  <Repeat className="size-5 shrink-0 text-ink-3" aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-ink">{r.service.name}</span>
                    <span className="truncate text-sm text-ink-2">{r.business.name}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

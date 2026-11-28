'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BoardLive } from '@/components/motion/board';
import { SplitFlap } from '@/components/motion/split-flap';
import { fetchVisits } from '@/features/booking/api';
import { clockLabel, dayParts } from '@/features/booking/choices';
import { fetchMyTicket, MY_TICKET_KEY } from '@/features/queue/api';
import type { QueueTicket } from '@/features/queue/types';

const two = (n: number) => String(Math.min(n, 99)).padStart(2, '0');

/** What the board says under someone's number, as the queue's own board says it. */
function lineFor(t: QueueTicket): string {
  if (t.status === 'called') return 'It’s your turn. Head to the counter.';
  if (t.status === 'serving') return 'You’re being served.';
  if (t.ahead === 0) return 'You’re next. Head over now.';
  // How many are ahead is on the flaps beside the number: the line says what they don't.
  const wait = t.estimatedWaitMinutes;
  return `${wait ? `About ${wait} minutes. ` : ''}We’ll tell you when to head over.`;
}

/** The board's own way on, as on the home page's board: its green, its dark ink. */
function BoardLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center self-start rounded-full bg-board-go-fill px-5 text-[0.95rem] font-semibold text-board-on-go transition-transform duration-150 ease-(--ease-out) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-go active:scale-[0.96]"
    >
      {children}
    </Link>
  );
}

/** The board itself: BUKU's waiting-room board, holding this person's own number or visit. */
function Board({ live, children }: { live: boolean; children: ReactNode }) {
  return (
    <section
      aria-labelledby="right-now"
      className="relative flex flex-col gap-6 overflow-hidden rounded-2xl bg-board p-6 text-board-ink shadow-lift ring-1 ring-white/8 sm:p-8 dark:ring-white/12"
    >
      {/* Light catching the top edge of the board. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/15" />
      <div className="flex items-center justify-between gap-4 text-sm font-medium text-board-ink-2">
        <h2 id="right-now">Right now</h2>
        {live && <BoardLive still={false} />}
      </div>
      {children}
    </section>
  );
}

/**
 * The one thing that matters most when someone opens BUKU: their place in a line (the number, how
 * many are ahead, said as the board says it, kept fresh), else their next visit, else an invitation
 * to take a number. On the board people already know from BUKU.
 */
export function RightNow() {
  const ticket = useQuery({
    queryKey: MY_TICKET_KEY,
    queryFn: fetchMyTicket,
    // A line moves: kept fresh while there's a number to watch.
    refetchInterval: (q) => (q.state.data ? 15_000 : false),
  });
  const upcoming = useQuery({
    queryKey: ['visits', 'upcoming', 'home'],
    queryFn: () => fetchVisits('upcoming', 1, 3),
  });

  if (ticket.isPending || (!ticket.data && upcoming.isPending)) {
    return (
      <Board live={false}>
        <div aria-hidden className="h-40 animate-pulse rounded-xl bg-board-tile" />
        <p className="sr-only" role="status">
          Loading
        </p>
      </Board>
    );
  }

  const t = ticket.data;
  if (t && (t.status === 'waiting' || t.status === 'called' || t.status === 'serving')) {
    const turn = t.status !== 'waiting' || t.ahead === 0;
    return (
      <Board live>
        <div className="flex flex-col gap-1">
          <p className="text-board-ink-2">Your number at</p>
          <p className="truncate text-xl font-semibold tracking-[-0.02em]">{t.business.name}</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <p
            className="tabular text-[3.6rem] leading-none font-semibold tracking-[-0.03em] sm:text-[4.5rem]"
            style={turn ? { color: 'var(--color-board-spark)' } : undefined}
          >
            {t.ticket}
          </p>
          {t.status === 'waiting' && t.ahead !== null && t.ahead > 0 && (
            <div className="flex flex-col items-end gap-1">
              <SplitFlap
                value={two(t.ahead)}
                label={`${t.ahead} ahead of you`}
                className="text-[2.6rem] font-semibold sm:text-[3rem]"
              />
              <span className="text-sm text-board-ink-2">ahead of you</span>
            </div>
          )}
        </div>
        <p aria-live="polite" className="text-lg text-board-ink">
          {lineFor(t)}
        </p>
        <BoardLink href={`/queue/${t.id}` as Route}>Open your ticket</BoardLink>
      </Board>
    );
  }

  const next = upcoming.data?.items[0];
  if (next) {
    return (
      <Board live={false}>
        <div className="flex flex-col gap-1">
          <p className="text-board-ink-2">Your next visit</p>
          <p className="text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[3.2rem]">
            {dayParts(next.local.date).label}
            <span className="block text-board-go">{clockLabel(next.local.startTime)}</span>
          </p>
        </div>
        <p className="text-lg">
          {next.service.name}
          {next.staff ? ` with ${next.staff.displayName}` : ''}
          <span className="block text-board-ink-2">{next.business.name}</span>
        </p>
        <BoardLink href={`/appointments/${next.id}` as Route}>Open your booking</BoardLink>
      </Board>
    );
  }

  return (
    <Board live={false}>
      <div className="flex items-end gap-4">
        <SplitFlap
          value="--"
          label="No number yet"
          className="text-[3.6rem] font-semibold sm:text-[4.5rem]"
        />
      </div>
      <p className="max-w-[34ch] text-lg">
        No number yet. Book a time or take a number at a place near you, and watch it here.
      </p>
      <BoardLink href={'/explore'}>Find a place</BoardLink>
    </Board>
  );
}

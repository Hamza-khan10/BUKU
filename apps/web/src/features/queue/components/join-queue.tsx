'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Ticket } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { distance } from '@/lib/format';
import { fetchMyTicket, joinQueue, MY_TICKET_KEY, TICKET_KEY } from '../api';
import { currentPosition, POSITION_MESSAGES, PositionError } from '../location';

/** The API's refusals to join, in words (anything else: its own message). */
function joinProblem(err: unknown, radiusMeters: number): Problem {
  if (err instanceof PositionError) return { title: POSITION_MESSAGES[err.problem] };
  if (!(err instanceof ApiError)) return problemFrom(err, 'Joining didn’t work. Please try again.');
  const details = err.details as { distanceMeters?: unknown } | undefined;
  switch (err.code) {
    case 'QUEUE_TOO_FAR':
      return typeof details?.distanceMeters === 'number'
        ? {
            title: `You’re ${distance(details.distanceMeters / 1000)} away.`,
            detail: `You can join from within ${distance(radiusMeters / 1000)}, or at the counter.`,
          }
        : { title: 'This business takes queue sign-ups at the counter only.' };
    case 'QUEUE_PAUSED':
      return {
        title: 'The queue is paused for now.',
        detail: 'No new sign-ups from phones right now. Try again soon.',
      };
    case 'QUEUE_CLOSED':
      return { title: 'The queue has closed.' };
    case 'QUEUE_FULL':
      return { title: 'The queue is full for now.', detail: 'Try again when it has moved on.' };
    case 'BOOKING_NOT_ALLOWED':
      return { title: 'Team accounts can’t join queues.', detail: 'Sign in with your own account to join.' };
    default:
      return problemFrom(err, 'Joining didn’t work. Please try again.');
  }
}

/**
 * Joining a business's walk-in queue from the phone. The queue only takes
 * people within its distance, so the phone's position is asked for — once,
 * when the button is pressed, never before — and used only for that check.
 * One live ticket at a time, anywhere: if there is one, it's shown instead.
 */
export function JoinQueue({
  business,
  signedIn,
  paused,
  radiusMeters,
}: {
  business: { id: string; slug: string };
  signedIn: boolean;
  paused: boolean;
  radiusMeters: number;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const mine = useQuery({ queryKey: MY_TICKET_KEY, queryFn: fetchMyTicket, enabled: signedIn });

  if (!signedIn) {
    return (
      <Button asChild variant="primary" block className="mt-4">
        <Link href={`/signin?next=${encodeURIComponent(`/b/${business.slug}`)}` as Route}>
          Sign in to join
        </Link>
      </Button>
    );
  }

  const ticket = mine.data;
  if (ticket) {
    const here = ticket.business.id === business.id;
    return (
      <div className="mt-4 flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          {here ? (
            <>
              You’re in this queue: ticket{' '}
              <span className="font-mono font-semibold text-ink">{ticket.ticket}</span>.
            </>
          ) : (
            <>You’re in the queue at {ticket.business.name}. Leave it first to join this one.</>
          )}
        </p>
        <Button asChild variant={here ? 'primary' : 'secondary'} block>
          <Link href={`/queue/${ticket.id}` as Route}>
            <Ticket aria-hidden /> Open your ticket
          </Link>
        </Button>
      </div>
    );
  }

  if (paused) return null;

  const join = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const at = await currentPosition();
      const joined = await joinQueue(business.id, at);
      queryClient.setQueryData(TICKET_KEY(joined.id), joined);
      queryClient.setQueryData(MY_TICKET_KEY, joined);
      router.push(`/queue/${joined.id}?joined=1` as Route);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'QUEUE_ALREADY_JOINED') {
        await queryClient.invalidateQueries({ queryKey: MY_TICKET_KEY });
        return;
      }
      setProblem(joinProblem(err, radiusMeters));
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Button variant="primary" block loading={busy} onClick={() => void join()}>
        Join the queue
      </Button>
      <p className="flex gap-2 text-xs text-ink-3">
        <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Joining checks once that you’re within {distance(radiusMeters / 1000)}. Your location isn’t kept.
      </p>
      {problem && (
        <Alert tone="danger" title={problem.title}>
          {problem.detail && <p>{problem.detail}</p>}
          {problem.reference && <p className="font-mono text-xs">Reference: {problem.reference}</p>}
        </Alert>
      )}
    </div>
  );
}

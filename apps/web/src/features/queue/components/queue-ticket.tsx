'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Ticket, type TicketProps } from '@/components/ui/ticket';
import { toast } from '@/components/ui/toaster';
import { problemFrom } from '@/features/auth/problems';
import { useMinute } from '@/features/booking/notice';
import { ApiError } from '@/lib/api/errors';
import { fetchTicket, leaveQueue, MY_TICKET_KEY, TICKET_KEY } from '../api';
import { changedSince, livePlace, waitLabel, type LivePlace } from '../position';
import type { QueueTicket as QueueTicketData } from '../types';
import { useLiveQueue } from '../use-live-queue';

const ACTIVE = new Set(['waiting', 'called', 'serving']);

/** "10:42" in the visitor's own clock (they're at, or near, the business). */
const clock = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/**
 * A queue ticket, live. While it's active the page follows the business's
 * queue (ticket numbers only) and works out the place in line itself, asking
 * the API again only when the ticket's state changes. When it's the person's
 * turn the page says so loudly — in the tab's title too, and with a buzz on
 * phones that can — and how long they have to reach the counter.
 */
export function QueueTicketView({ id, joined }: { id: string; joined: boolean }) {
  const ticket = useQuery({
    queryKey: TICKET_KEY(id),
    queryFn: () => fetchTicket(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  if (ticket.isPending) {
    return (
      <div role="status" aria-label="Loading your ticket" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-56 max-w-xl" />
      </div>
    );
  }
  if (ticket.error) {
    const e = ticket.error instanceof ApiError ? ticket.error : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this ticket' : 'We couldn’t load your ticket'}
        message={
          e?.status === 404
            ? 'It may belong to another account. Tickets are only shown to the person in the queue.'
            : (e?.message ?? 'Please try again in a moment.')
        }
        reference={e?.status === 404 ? undefined : e?.requestId}
      />
    );
  }
  return ACTIVE.has(ticket.data.status) ? (
    <LiveTicket ticket={ticket.data} joined={joined} />
  ) : (
    <TicketCard ticket={ticket.data} place={null} live={false} joined={false} />
  );
}

function LiveTicket({ ticket, joined }: { ticket: QueueTicketData; joined: boolean }) {
  const queryClient = useQueryClient();
  const { state, live } = useLiveQueue(ticket.business.slug);
  const place = state ? livePlace(state, ticket.ticket) : null;
  const phase = place?.phase === 'gone' ? null : (place?.phase ?? ticket.status);
  const previous = useRef(phase);

  // The live line says something the ticket doesn't (called, served, left): ask the API.
  const stale = place !== null && changedSince(ticket, place);
  useEffect(() => {
    if (stale) void queryClient.invalidateQueries({ queryKey: TICKET_KEY(ticket.id) });
  }, [stale, queryClient, ticket.id]);

  // Their turn: say it in the tab's title (it may be in the background), and buzz phones that can.
  useEffect(() => {
    const before = document.title;
    if (phase === 'called') document.title = `It’s your turn — ${ticket.ticket} · BUKU`;
    else if (place?.phase === 'waiting')
      document.title = `${place.ahead === 0 ? 'You’re next' : `${place.ahead} ahead`} — ${ticket.ticket} · BUKU`;
    if (phase === 'called' && previous.current !== 'called') {
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        // Not every browser allows it; the page says it anyway.
      }
    }
    previous.current = phase;
    return () => {
      document.title = before;
    };
  }, [phase, place, ticket.ticket]);

  return <TicketCard ticket={ticket} place={place} live={live} joined={joined} />;
}

function TicketCard({
  ticket: t,
  place,
  live,
  joined,
}: {
  ticket: QueueTicketData;
  place: LivePlace | null;
  live: boolean;
  joined: boolean;
}) {
  const minute = useMinute();
  // Live place first (it's newer); the ticket as the API last described it otherwise.
  const status = place && place.phase !== 'gone' ? place.phase : t.status;
  const ahead = place?.phase === 'waiting' ? place.ahead : t.ahead;
  const minutes = place?.phase === 'waiting' ? place.minutes : t.estimatedWaitMinutes;
  const active = ACTIVE.has(status);
  const minutesLeft =
    t.comeBy && minute !== null ? Math.max(0, Math.ceil((Date.parse(t.comeBy) - minute) / 60_000)) : null;

  const band: TicketProps['status'] = {
    waiting: { label: 'In the queue', tone: 'wait', live },
    called: { label: 'It’s your turn', tone: 'brand', live },
    serving: { label: 'Being served', tone: 'ok' },
    completed: { label: 'Done', tone: 'neutral' },
    left: { label: 'You left the queue', tone: 'neutral' },
    no_show: { label: 'Missed', tone: 'danger' },
  }[status] as TicketProps['status'];

  const title = {
    waiting: ahead === 0 ? 'You’re next' : ahead === null ? 'Waiting' : `${ahead} ahead of you`,
    called: 'Go to the counter',
    serving: 'You’re at the counter',
    completed: 'All done — thanks for visiting',
    left: 'You left the queue',
    no_show: 'Your turn passed',
  }[status];

  const when =
    status === 'waiting'
      ? minutes !== null && minutes !== undefined
        ? ahead === 0
          ? 'Any moment now'
          : `About ${waitLabel(minutes)}`
        : 'Waiting'
      : status === 'called'
        ? t.comeBy
          ? `Please be there by ${clock(t.comeBy)}${minutesLeft !== null ? ` (${minutesLeft === 0 ? 'now' : `${minutesLeft} min`})` : ''}`
          : 'Please go now'
        : status === 'no_show'
          ? 'You weren’t at the counter in time'
          : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          href={`/b/${t.business.slug}` as Route}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> {t.business.name}
        </Link>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {joined && status === 'waiting' ? 'You’re in the queue' : 'Your ticket'}
        </h1>
        {active && (
          <p className="text-ink-2" aria-live="polite">
            {live
              ? 'This page updates by itself — keep it open.'
              : 'Reconnecting… the numbers may be a little behind.'}
          </p>
        )}
      </header>

      <Ticket
        fresh={joined}
        status={band}
        place={t.business.name}
        title={<span aria-live="polite">{title}</span>}
        when={when}
        details={<span>Joined at {clock(t.joinedAt)}</span>}
        code={t.ticket}
        codeLabel="Your ticket"
      />

      {status === 'called' && (
        <Alert tone="wait" title="Show your ticket number at the counter">
          If you aren’t there in time, the business may move on to the next person.
        </Alert>
      )}

      <div className="flex flex-wrap gap-3">
        {(status === 'waiting' || status === 'called') && <LeaveQueue ticket={t} />}
        {!active && (
          <Button asChild variant="secondary">
            <Link href={`/b/${t.business.slug}` as Route}>Back to {t.business.name}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Leaving: the place goes to the next person; joining again starts at the back. Said before, not after. */
function LeaveQueue({ ticket }: { ticket: QueueTicketData }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      const left = await leaveQueue(ticket.id);
      queryClient.setQueryData(TICKET_KEY(ticket.id), left);
      queryClient.setQueryData(MY_TICKET_KEY, null);
      setOpen(false);
      toast('You’ve left the queue.');
    } catch (err) {
      setError(problemFrom(err, 'Leaving didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Leave the queue</Button>
      </DialogTrigger>
      <DialogContent
        title="Leave the queue?"
        description="Your place goes to the next person. You can join again, but at the back of the line."
      >
        <div className="flex flex-col gap-4">
          {error && <Alert tone="danger" title={error} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Stay in the queue</Button>
            </DialogClose>
            <Button variant="danger" loading={busy} onClick={() => void leave()}>
              Leave the queue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Ticket, type TicketProps } from '@/components/ui/ticket';
import { ApiError } from '@/lib/api/errors';
import { money } from '@/lib/format';
import { fetchReceipt, RECEIPT_KEY } from '../api';
import { clockLabel, dayParts } from '../choices';
import type { Receipt } from '../types';
import { VisitActions } from './visit-actions';

/** Where the visit stands, in the ticket's band. */
function statusOf(r: Receipt): TicketProps['status'] {
  switch (r.status) {
    case 'pending':
      return { label: 'Requested: waiting for the business to confirm', tone: 'wait', live: true };
    case 'confirmed':
      return r.checkedInAt ? { label: 'Checked in', tone: 'ok' } : { label: 'Confirmed', tone: 'ok' };
    case 'completed':
      return { label: 'Visited', tone: 'neutral' };
    case 'rescheduled':
      return { label: 'Moved to a new time', tone: 'neutral' };
    case 'no_show':
      return { label: 'Missed', tone: 'danger' };
    case 'cancelled':
      return {
        label:
          r.cancellation?.cancelledBy === 'user'
            ? 'Cancelled by you'
            : r.cancellation?.reasonCode === 'declined'
              ? 'Declined by the business'
              : 'Cancelled by the business',
        tone: 'danger',
      };
  }
}

/** "Mon 6 Oct, 2:00 pm" — a moment on the business's own clock. */
function momentLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/**
 * A booking's receipt (D-057): the ticket people show at the front desk — the
 * code in large letters and the QR the desk scans (the code only, nothing
 * personal) — what, where, when on the business's clock, the price paid at
 * the venue, and the business's cancellation terms for this visit.
 */
/** How the person arrived here: just booked, just moved, or simply opened it. */
export type Arrival = 'booked' | 'moved' | null;

export function ReceiptView({ id, arrival }: { id: string; arrival: Arrival }) {
  const fresh = arrival !== null;
  const receipt = useQuery({
    queryKey: RECEIPT_KEY(id),
    queryFn: () => fetchReceipt(id),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 401)) && n < 2,
  });

  if (receipt.isPending) {
    return (
      <div role="status" aria-label="Loading your booking" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 max-w-xl" />
      </div>
    );
  }
  if (receipt.error) {
    const e = receipt.error instanceof ApiError ? receipt.error : null;
    return (
      <ErrorState
        title={e?.status === 404 ? 'We couldn’t find this booking' : 'We couldn’t load this booking'}
        message={
          e?.status === 404
            ? 'It may belong to another account. Bookings are only shown to the person who made them.'
            : (e?.message ?? 'Please try again in a moment.')
        }
        reference={e?.status === 404 ? undefined : e?.requestId}
        action={
          e?.status === 404 ? undefined : (
            <Button variant="secondary" onClick={() => void receipt.refetch()}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const r = receipt.data;
  const tz = r.local.timezone;
  const live = r.status === 'pending' || r.status === 'confirmed';
  const heading =
    arrival === 'moved'
      ? 'Moved to the new time'
      : arrival === 'booked'
        ? r.status === 'pending'
          ? 'Request sent'
          : 'You’re booked'
        : live
          ? 'Your booking'
          : 'Booking';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/account/appointments"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> Your visits
        </Link>
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">{heading}</h1>
        {arrival === 'moved' && (
          <p className="text-ink-2">
            It has a new booking code: the old one no longer works.
            {r.status === 'pending' &&
              ` ${r.business.name} confirms the new time; you’ll be told when they do.`}
          </p>
        )}
        {arrival === 'booked' && r.status === 'pending' && (
          <p className="text-ink-2">
            {r.business.name} confirms each booking. You’ll be told as soon as they do. The time is held for
            you meanwhile.
          </p>
        )}
        {arrival === 'booked' && r.status === 'confirmed' && (
          <p className="text-ink-2">See you there. Show this code at the front desk, or let them scan it.</p>
        )}
      </header>

      <Ticket
        fresh={fresh}
        status={statusOf(r)}
        place={r.business.name}
        title={`${r.service.name}${r.staff ? ` with ${r.staff.displayName}` : ''}`}
        when={`${dayParts(r.local.date).label}, ${clockLabel(r.local.startTime)} – ${clockLabel(r.local.endTime)}`}
        details={
          <>
            <span>
              {r.business.address.line}, {r.business.address.city}
            </span>
            <span>
              <span className="font-semibold text-ink tabular">{money(r.price, r.currency)}</span>, paid at
              the venue
            </span>
          </>
        }
        code={r.code}
        codeLabel="Booking code"
        qr={live}
      />

      <div className="flex max-w-xl flex-col gap-4 text-sm text-ink-2">
        {live && r.policy.canCancel && (
          <p>
            {/* The API says the free window is still open: moving is allowed only until it closes. */}
            {r.policy.canReschedule
              ? `Free to cancel or move until ${momentLabel(r.policy.freeCancellationUntil, tz)} (${tz}). After that, cancelling counts as late.`
              : 'The free cancellation time has passed: cancelling now counts as late.'}
          </p>
        )}
        {r.notes && (
          <p>
            <span className="font-medium text-ink">Your note:</span> {r.notes}
          </p>
        )}
        {r.cancellation?.reason && (
          <p>
            <span className="font-medium text-ink">Reason given:</span> {r.cancellation.reason}
          </p>
        )}
        <VisitActions receipt={r} />
      </div>
    </div>
  );
}

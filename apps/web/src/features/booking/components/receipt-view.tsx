'use client';

import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import type { Route } from 'next';
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

/** Where the visit stands, in the ticket's band. */
function statusOf(r: Receipt): TicketProps['status'] {
  switch (r.status) {
    case 'pending':
      return { label: 'Requested — waiting for the business to confirm', tone: 'wait', live: true };
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
        label: r.cancellation?.cancelledBy === 'customer' ? 'Cancelled by you' : 'Cancelled by the business',
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
export function ReceiptView({ id, fresh }: { id: string; fresh: boolean }) {
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
  const heading = fresh
    ? r.status === 'pending'
      ? 'Request sent'
      : 'You’re booked'
    : live
      ? 'Your booking'
      : 'Booking';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-bold tracking-tight">{heading}</h1>
        {fresh && r.status === 'pending' && (
          <p className="text-ink-2">
            {r.business.name} confirms each booking. You’ll be told as soon as they do — the time is held for
            you meanwhile.
          </p>
        )}
        {fresh && r.status === 'confirmed' && (
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
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="secondary">
            <Link href={`/b/${r.business.slug}` as Route}>
              <MapPin aria-hidden /> {r.business.name}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

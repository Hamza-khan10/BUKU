'use client';

import { zText } from '@buku/validation';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CleanTextarea } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { BookingTerms } from '@/features/business/components/services-menu';
import type { ServiceItem, ServiceMenu, StaffMember } from '@/features/business/types';
import { duration, money } from '@/lib/format';
import { clockLabel, dayParts } from '../choices';
import type { Slot } from '../types';

const NOTE = zText({ kind: 'text', max: 500 });

/** "10:45" — a moment on the business's own clock. */
const wallTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );

/** This device's time zone; null while rendering on the server. */
const noChange = () => () => undefined;
function useDeviceTimeZone(): string | null {
  return useSyncExternalStore(
    noChange,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );
}

/** The current minute (ms), refreshed while the page is open; null while rendering on the server. */
const subscribeClock = (onChange: () => void) => {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
};
function useMinute(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => null,
  );
}

export interface SummaryProblem {
  title: string;
  detail?: string | undefined;
  reference?: string | undefined;
  /** Offer to sign in again (the session ended mid-booking); the choices stay in the address. */
  signIn?: boolean;
}

/**
 * What is about to be booked, in full — business, what, with whom, when (on
 * the business's clock, said so when the visitor's differs), the price paid
 * at the venue, the business's terms — and the one button. Signed out, the
 * button signs in first and comes back to this exact choice.
 */
export function BookingSummary({
  businessName,
  city,
  timezone,
  service,
  person,
  slot,
  booking,
  signedIn,
  canBook = true,
  signInHref,
  busy,
  problem,
  noteError,
  onBook,
}: {
  businessName: string;
  city: string;
  timezone: string;
  service: ServiceItem | null;
  person: StaffMember | null;
  slot: Slot | null;
  booking: ServiceMenu['booking'];
  signedIn: boolean;
  /** False for accounts that can't book (a business's team accounts). */
  canBook?: boolean;
  signInHref: string;
  busy: boolean;
  problem: SummaryProblem | null;
  noteError: string | undefined;
  onBook: (note: string | undefined) => void;
}) {
  const deviceZone = useDeviceTimeZone();
  const now = useMinute();
  const windowMs = booking.cancellationWindowHours * 3_600_000;
  // A time inside the business's notice period: say so before booking, not after.
  const insideNotice =
    Boolean(slot && now !== null && windowMs > 0) && Date.parse(slot!.startAt) - now! < windowMs;
  const [note, setNote] = useState('');
  const [localNoteError, setLocalNoteError] = useState<string | undefined>();
  const ready = Boolean(service && slot);

  const submit = () => {
    const trimmed = note.trim();
    if (trimmed) {
      const parsed = NOTE.safeParse(trimmed);
      if (!parsed.success) {
        setLocalNoteError(parsed.error.issues[0]?.message);
        return;
      }
      setLocalNoteError(undefined);
      onBook(parsed.data);
    } else {
      setLocalNoteError(undefined);
      onBook(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 shadow-soft">
      <h2
        id="your-booking"
        tabIndex={-1}
        className="font-display text-xl font-semibold text-ink focus:outline-none"
      >
        Your booking
      </h2>
      <dl className="flex flex-col gap-3 text-sm">
        <Row term="Where">{businessName}</Row>
        <Row term="What">
          {service ? (
            `${service.name} · ${duration(service.durationMinutes)}`
          ) : (
            <Missing>Choose a service</Missing>
          )}
        </Row>
        <Row term="With">{service ? (person?.displayName ?? 'Anyone available') : <Missing>—</Missing>}</Row>
        <Row term="When">
          {slot ? (
            <>
              {dayParts(localDate(slot.startAt, timezone)).label}, {clockLabel(slot.time)} –{' '}
              {clockLabel(wallTime(slot.endAt, timezone))}
            </>
          ) : (
            <Missing>Choose a day and a time</Missing>
          )}
        </Row>
        <Row term="Price">
          {service ? (
            <>
              <span className="font-semibold text-ink tabular">{money(service.price, service.currency)}</span>
              , paid at the venue
            </>
          ) : (
            <Missing>—</Missing>
          )}
        </Row>
      </dl>
      {insideNotice && (
        <Alert
          tone="wait"
          title={`This visit is less than ${duration(booking.cancellationWindowHours * 60)} away`}
        >
          That’s inside {businessName}’s notice period: if you cancel it, it counts as a late cancellation,
          and it can’t be moved.
        </Alert>
      )}
      {slot && deviceZone && deviceZone !== timezone && (
        <p className="text-sm text-ink-3">
          Times are {city} time ({timezone}).
        </p>
      )}

      {ready && (
        <Field
          label="Note for the business"
          hint="Anything they should know before you arrive."
          error={noteError ?? localNoteError}
        >
          <CleanTextarea
            kind="text"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </Field>
      )}

      {problem && (
        <Alert tone="danger" title={problem.title}>
          {problem.detail && <p>{problem.detail}</p>}
          {problem.signIn && (
            <Link
              href={signInHref as Route}
              className="font-medium text-brand-ink underline underline-offset-4"
            >
              Sign in again
            </Link>
          )}
          {problem.reference && <p className="font-mono text-xs">Reference: {problem.reference}</p>}
        </Alert>
      )}

      {signedIn ? (
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready || !canBook}
          loading={busy}
          onClick={submit}
        >
          {booking.confirmationMode === 'manual' ? 'Request this booking' : 'Book'}
        </Button>
      ) : ready ? (
        <Button asChild variant="primary" size="lg" block>
          <Link href={signInHref as Route}>Sign in to book</Link>
        </Button>
      ) : (
        <Button variant="primary" size="lg" block disabled>
          Book
        </Button>
      )}
      {!signedIn && ready && (
        <p className="-mt-2 text-center text-sm text-ink-3">You’ll come straight back to this time.</p>
      )}

      <BookingTerms booking={booking} />
    </div>
  );
}

/** "2026-10-06": the calendar day of a moment, on the business's clock. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-3">
      <dt className="text-ink-3">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return <span className="text-ink-3">{children}</span>;
}

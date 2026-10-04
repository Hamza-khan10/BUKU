import { QRCodeSVG } from 'qrcode.react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * BUKU's signature: a receipt or queue ticket that looks like a real one —
 * the main part says what and when, a perforated stub carries the code (and
 * the QR the front desk scans), a band on top says where things stand.
 * People already trust paper tickets; this borrows that trust (WEB_PLAN §2).
 *
 * Stacks vertically on narrow screens (stub at the bottom), side by side from
 * `sm`. The QR encodes exactly the code shown, nothing more. Place it on the
 * page background: the notches are cut in that colour.
 */

const tones = {
  ok: 'bg-ok text-surface',
  wait: 'bg-wait text-on-wait',
  brand: 'bg-brand text-on-brand',
  neutral: 'bg-ink-2 text-surface',
  danger: 'bg-danger text-surface',
} as const;

export interface TicketProps {
  /** "Haircut with Ali" / "Walk-in queue". */
  title: ReactNode;
  /** The business. */
  place: ReactNode;
  /** When (already formatted in the business's timezone), or the queue position. */
  when: ReactNode;
  /** Extra lines (address, price "pay at the venue", people ahead). */
  details?: ReactNode;
  /** The code people show: "BK-7KQ2MX" or "A-023". */
  code: string;
  /** Label above the code: "Booking code" / "Your ticket". */
  codeLabel: string;
  status: { label: ReactNode; tone: keyof typeof tones; live?: boolean };
  /** Show the QR code (receipts); queue tickets show the number only. */
  qr?: boolean;
  /** Play the "printing" entrance (a booking that was just confirmed). */
  fresh?: boolean;
  className?: string;
}

export function Ticket({
  title,
  place,
  when,
  details,
  code,
  codeLabel,
  status,
  qr,
  fresh,
  className,
}: TicketProps) {
  return (
    <article
      className={cn(
        'relative isolate w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-lift',
        fresh && 'animate-print',
        className,
      )}
    >
      <div className={cn('flex items-center gap-2 px-5 py-2 text-sm font-semibold', tones[status.tone])}>
        {status.live && <span aria-hidden className="size-2 rounded-full bg-current animate-live" />}
        <span role="status">{status.label}</span>
      </div>

      <div className="flex flex-col sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
          <p className="text-sm font-medium text-ink-3">{place}</p>
          <h3 className="font-display text-2xl leading-tight font-semibold tracking-tight">{title}</h3>
          <p className="tabular text-lg font-medium text-ink">{when}</p>
          {details && <div className="flex flex-col gap-1 text-sm text-ink-2">{details}</div>}
        </div>

        {/* The perforation: a dashed line with half-circle notches cut out of the ticket's edges
            (left and right on phones; top and bottom, over the band too, from `sm`). */}
        <div aria-hidden className="relative flex items-center">
          <span className="absolute -left-3 size-6 rounded-full bg-canvas sm:hidden" />
          <span className="h-px w-full border-t-2 border-dashed border-line sm:h-full sm:w-px sm:border-t-0 sm:border-l-2" />
          <span className="absolute -right-3 size-6 rounded-full bg-canvas sm:hidden" />
        </div>

        <div className="flex flex-col items-center justify-center gap-2 p-5 sm:w-48">
          <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{codeLabel}</p>
          <p className="font-mono text-2xl font-bold tracking-wider text-ink">{code}</p>
          {qr && (
            <div role="img" aria-label={`QR code for ${code}`} className="rounded-md bg-white p-2">
              <QRCodeSVG value={code} size={112} level="M" aria-hidden />
            </div>
          )}
        </div>
      </div>
      <span
        aria-hidden
        className="absolute -top-3 right-[calc(12rem-0.75rem)] hidden size-6 rounded-full bg-canvas sm:block"
      />
      <span
        aria-hidden
        className="absolute -bottom-3 right-[calc(12rem-0.75rem)] hidden size-6 rounded-full bg-canvas sm:block"
      />
    </article>
  );
}

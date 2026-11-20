import { QRCodeSVG } from 'qrcode.react';
import type { ReactNode } from 'react';
import { MARK } from '@/components/brand/mark';
import { cn } from '@/lib/cn';

/**
 * BUKU's signature: a receipt or queue ticket that looks like a real one: a band that says where
 * things stand (with the BUKU mark, Brand Identity v1.0's "ticket edge"), the main part saying what,
 * where and when, a perforation with half-circle notches, and a stub with the code (and the QR the
 * front desk scans). People already trust paper tickets; this borrows that trust (WEB_PLAN §2).
 *
 * One ticket everywhere (3.7i): the app, How it works and the phone in the home page's story. Its
 * layout and type follow its own width (container queries), not the screen's: stacked, with the stub
 * below, when narrow (a phone, the story's phone); side by side from 28rem. The QR encodes exactly
 * the code shown, nothing more. Place it on the page background: the notches are cut in that colour.
 */

/** The band's colours, and the mark's dot on it (Saffron; Emerald on a Saffron band, as the kit says). */
const tones = {
  ok: 'bg-ok text-surface [--ticket-dot:#ffad52]',
  wait: 'bg-wait text-on-wait [--ticket-dot:#056549]',
  brand: 'bg-brand text-on-brand [--ticket-dot:#ffad52]',
  neutral: 'bg-ink-2 text-surface [--ticket-dot:#ffad52]',
  danger: 'bg-danger text-surface [--ticket-dot:#ffffff]',
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
  /** The title's element: a heading on a page, plain text inside an illustration (the story's phone). */
  titleAs?: 'h3' | 'p';
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
  titleAs: Title = 'h3',
  className,
}: TicketProps) {
  return (
    <article
      className={cn(
        '@container relative isolate w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-lift ring-1 ring-line/50',
        fresh && 'animate-print',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-5 py-2.5 text-sm font-semibold @md:px-6',
          tones[status.tone],
        )}
      >
        {/* The BUKU mark, as on a printed ticket: the U in the band's ink, its dot the kit's colour. */}
        <svg viewBox="0 0 60 60" aria-hidden className="size-4 shrink-0">
          <path
            d={MARK.cup}
            fill="none"
            stroke="currentColor"
            strokeWidth={MARK.cupWidth}
            strokeLinecap="round"
          />
          <circle {...MARK.dot} fill="var(--ticket-dot)" />
        </svg>
        <span role="status">{status.label}</span>
        {status.live && <span aria-hidden className="ml-auto size-2 rounded-full bg-current animate-live" />}
      </div>

      <div className="flex flex-col @md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-5 @md:p-7">
          <p className="text-[0.8rem] font-medium text-ink-3 @md:text-sm">{place}</p>
          <Title className="text-[1.3rem] leading-[1.08] font-semibold tracking-[-0.03em] @xs:text-[1.5rem] @md:text-[1.85rem]">
            {title}
          </Title>
          <p className="tabular mt-1.5 text-[0.95rem] font-semibold text-ink @xs:text-base @md:text-[1.15rem]">
            {when}
          </p>
          {details && (
            <div className="flex flex-col gap-1 text-[0.8rem] text-ink-2 @md:text-sm">{details}</div>
          )}
        </div>

        {/* The perforation: a dashed line with half-circle notches cut out of the ticket's edges
            (left and right when stacked; top and bottom, over the band too, side by side). */}
        <div aria-hidden className="relative flex items-center">
          <span className="absolute -left-3 size-6 rounded-full bg-canvas @md:hidden" />
          <span className="mx-5 h-px w-full border-t-2 border-dashed border-line @md:mx-0 @md:h-full @md:w-px @md:border-t-0 @md:border-l-2" />
          <span className="absolute -right-3 size-6 rounded-full bg-canvas @md:hidden" />
        </div>

        <div className="flex items-center justify-between gap-4 p-5 @md:w-52 @md:flex-col @md:justify-center @md:gap-3 @md:p-6 @md:text-center">
          <div className="flex flex-col gap-1">
            <p className="text-[0.7rem] font-semibold tracking-[0.08em] text-ink-3 uppercase">{codeLabel}</p>
            <p className="font-mono text-xl font-bold tracking-wider text-ink @xs:text-2xl @md:text-[1.65rem]">
              {code}
            </p>
          </div>
          {qr && (
            <div
              role="img"
              aria-label={`QR code for ${code}`}
              className="shrink-0 rounded-lg bg-white p-1.5 ring-1 ring-line @md:p-2"
            >
              <QRCodeSVG
                value={code}
                size={112}
                level="M"
                aria-hidden
                className="size-16 @xs:size-20 @md:size-28"
              />
            </div>
          )}
        </div>
      </div>
      <span
        aria-hidden
        className="absolute -top-3 right-[calc(13rem-0.75rem)] hidden size-6 rounded-full bg-canvas @md:block"
      />
      <span
        aria-hidden
        className="absolute -bottom-3 right-[calc(13rem-0.75rem)] hidden size-6 rounded-full bg-canvas @md:block"
      />
    </article>
  );
}

import { cn } from '@/lib/cn';

/**
 * The BUKU mark: a ticket whose stub carries a check, booking and queueing
 * in one shape. One component, so the brand can change in one place.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* Ticket body with the two half-circle notches of a perforated stub. */}
      <path
        d="M6 6h20a2 2 0 0 1 2 2v5a3 3 0 0 0 0 6v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5a3 3 0 0 0 0-6V8a2 2 0 0 1 2-2Z"
        fill="var(--brand)"
      />
      {/* Perforation. */}
      <path d="M20 9v14" stroke="var(--on-brand)" strokeWidth="1.6" strokeDasharray="1.6 2.2" opacity=".75" />
      {/* The check, on the main part of the ticket. */}
      <path
        d="m9.5 16.2 2.6 2.6 5-5.6"
        fill="none"
        stroke="var(--on-brand)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-ink', className)}>
      <LogoMark />
      <span className="text-[1.3rem] font-semibold tracking-[-0.03em]">BUKU</span>
    </span>
  );
}

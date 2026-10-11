import { cn } from '@/lib/cn';
import { BRAND, MARK } from './mark';

/**
 * The BUKU mark: a ticket, two clock hands that read as a check, and a Saffron
 * pivot (D-094). `reversed` is for Emerald or dark grounds. One component, so the
 * brand changes in one place.
 */
export function LogoMark({
  className,
  title,
  reversed = false,
}: {
  className?: string;
  title?: string;
  reversed?: boolean;
}) {
  const ticket = reversed ? BRAND.white : BRAND.emerald;
  const hands = reversed ? BRAND.emerald : BRAND.white;
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn('size-9 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={MARK.ticket} fill={ticket} />
      <path d={MARK.hour} stroke={hands} strokeWidth={MARK.hourWidth} strokeLinecap="round" />
      <path d={MARK.minute} stroke={hands} strokeWidth={MARK.minuteWidth} strokeLinecap="round" />
      <circle {...MARK.pivot} fill={BRAND.saffron} />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-ink', className)}>
      <LogoMark />
      <span className="text-[1.35rem] font-semibold tracking-[-0.035em]">BUKU</span>
    </span>
  );
}

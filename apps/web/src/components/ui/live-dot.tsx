import { cn } from '@/lib/cn';

/**
 * "This updates by itself" — a softly pulsing dot next to live things (queue
 * position, open now). The label is for screen readers; the dot is decoration.
 */
export function LiveDot({
  tone = 'ok',
  label,
  className,
}: {
  tone?: 'ok' | 'wait' | 'brand';
  label?: string;
  className?: string;
}) {
  const color = { ok: 'text-ok bg-ok', wait: 'text-wait bg-wait', brand: 'text-brand bg-brand' }[tone];
  return (
    <span className={cn('inline-flex items-center', className)}>
      <span aria-hidden className={cn('size-2.5 rounded-full animate-live', color)} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

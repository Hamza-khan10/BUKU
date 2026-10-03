import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Placeholder in the exact shape of what's loading, so nothing jumps when it
 * arrives. Hidden from screen readers: the region announces "Loading…" instead.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--sunken)_0%,var(--line)_50%,var(--sunken)_100%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

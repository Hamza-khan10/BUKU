import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * When there's nothing (yet): say so honestly, and offer the next step.
 * Never filled with made-up examples.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl bg-sunken/70 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon && (
        <span className="grid size-12 place-items-center rounded-full bg-surface text-ink-2 shadow-soft">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <h3 className="text-lg font-semibold tracking-[-0.015em]">{title}</h3>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Something went wrong: what happened in plain words, what to do next, and
 * the reference support needs to find it (never a blank screen).
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  reference,
  action,
  className,
}: {
  title?: ReactNode;
  message: ReactNode;
  /** The request id (or error digest) to quote to support. */
  reference?: string | undefined;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <h2 className="text-xl font-semibold tracking-[-0.02em]">{title}</h2>
      <p className="max-w-md text-ink-2">{message}</p>
      {action && <div className="mt-2">{action}</div>}
      {reference && (
        <p className="mt-2 text-xs text-ink-3">
          Reference: <span className="font-mono select-all">{reference}</span>
        </p>
      )}
    </div>
  );
}

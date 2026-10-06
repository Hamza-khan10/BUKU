import type { ComponentProps, ReactNode } from 'react';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  busy,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger'; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand text-brand-ink hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-sunken',
        variant === 'danger' && 'bg-danger text-surface hover:opacity-90',
        className,
      )}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-3">
          {hint}
        </p>
      )}
      {children({ id, describedBy })}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-md border border-line bg-surface px-3 text-[0.95rem] text-ink placeholder:text-ink-3 aria-invalid:border-danger';

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'danger' | 'ok' | 'wait';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'info' && 'border-line bg-sunken text-ink',
        tone === 'danger' && 'border-danger/40 bg-danger-soft text-ink',
        tone === 'ok' && 'border-ok/40 bg-ok-soft text-ink',
        tone === 'wait' && 'border-wait/40 bg-wait-soft text-ink',
      )}
    >
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-ink-2">{children}</div>}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
    >
      {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
      {children}
    </section>
  );
}

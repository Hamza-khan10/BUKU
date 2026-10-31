import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/**
 * The console's parts (D-131). Colour means one thing each: emerald = healthy/ours/go, saffron =
 * waiting, crimson = broken. Text never relies on colour alone: a word or an icon goes with it.
 */

export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  className,
  children,
  ...props
}: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-quiet' | 'ghost';
  size?: 'sm' | 'md';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'press inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[0.8rem]',
        variant === 'primary' &&
          'bg-brand text-brand-ink shadow-[0_8px_20px_-12px_var(--brand)] hover:bg-brand-hover',
        variant === 'secondary' &&
          'border border-line-strong bg-raised text-ink hover:border-control hover:bg-sunken',
        variant === 'danger' && 'bg-danger text-on-danger hover:bg-danger-hover',
        variant === 'danger-quiet' && 'border border-danger/45 text-danger hover:bg-danger-soft',
        variant === 'ghost' && 'text-ink-2 hover:bg-raised hover:text-ink',
        className,
      )}
    >
      {busy ? (
        <>
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
          Working…
        </>
      ) : (
        children
      )}
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

export const inputClass = cx(
  'h-11 w-full rounded-[10px] border border-control bg-sunken px-3.5 text-[0.95rem] text-ink',
  'placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150',
  'focus-visible:border-focus focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--focus)_22%,transparent)] focus-visible:outline-none',
  'aria-invalid:border-danger',
);

const NOTICE: Record<'info' | 'danger' | 'ok' | 'wait', { icon: LucideIcon; box: string; mark: string }> = {
  info: { icon: Info, box: 'border-line bg-sunken/70', mark: 'text-ink-2' },
  danger: { icon: OctagonAlert, box: 'border-danger/40 bg-danger-soft', mark: 'text-danger' },
  ok: { icon: CircleCheck, box: 'border-ok/35 bg-ok-soft', mark: 'text-ok' },
  wait: { icon: TriangleAlert, box: 'border-wait/40 bg-wait-soft', mark: 'text-wait' },
};

/** A message in the page: neutral information, success, something waiting, or trouble. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'danger' | 'ok' | 'wait';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { icon: Icon, box, mark } = NOTICE[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm', box)}
    >
      <Icon aria-hidden strokeWidth={2} className={cx('mt-px size-[1.1rem] shrink-0', mark)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold text-ink">{title}</p>
        {children && <div className="text-ink-2">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A raised panel with an optional heading, a line on what it is, and an action on the right. */
export function Card({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cx('panel flex flex-col gap-4 p-5 sm:p-6', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {title && <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
            {description && <p className="text-sm text-ink-3">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'ok' | 'wait' | 'danger' | 'brand' | 'neutral';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  wait: 'bg-wait-soft text-wait',
  danger: 'bg-danger-soft text-danger',
  brand: 'bg-brand-soft text-brand-text',
  neutral: 'bg-sunken text-ink-2 ring-1 ring-inset ring-line',
};

/** A short state in its colour ("Answering", "Critical", "Waiting"); status tones carry a dot. */
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONE[tone],
      )}
    >
      {(tone === 'ok' || tone === 'wait' || tone === 'danger') && (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

/** A status light; `live` breathes (for "watching now"). */
export function StatusDot({
  tone,
  live = false,
}: {
  tone: 'ok' | 'wait' | 'danger' | 'neutral';
  live?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-2 shrink-0 rounded-full bg-current',
        live && 'live',
        tone === 'ok' && 'text-ok',
        tone === 'wait' && 'text-wait',
        tone === 'danger' && 'text-danger',
        tone === 'neutral' && 'text-ink-3',
      )}
    />
  );
}

/** A page's heading: what it is, one line on what it's for, and its actions. */
export function PageTitle({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="rise mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-3xl flex-col gap-2">
        {eyebrow && <p className="text-sm font-medium text-brand-text">{eyebrow}</p>}
        <h1 className="text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.025em] text-ink sm:text-[2.1rem]">
          {title}
        </h1>
        {description && <p className="max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** A section's heading inside a page, with an optional line and a link on the right. */
export function SectionTitle({
  id,
  title,
  description,
  action,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description && <p className="text-sm text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** One number that matters: its label, the value (coloured by state), what it means, its trend. */
export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
  trend,
  icon: Icon,
  style,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  trend?: ReactNode;
  icon?: LucideIcon;
  style?: CSSProperties;
}) {
  return (
    <div className="panel rise flex min-w-0 flex-col gap-2 p-4 sm:p-5" style={style}>
      <p className="flex items-center gap-2 text-sm font-medium text-ink-2">
        {Icon && <Icon aria-hidden strokeWidth={1.75} className="size-4 text-ink-3" />}
        {label}
      </p>
      <p
        className={cx(
          'text-[1.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums',
          // Healthy numbers stay in ink: colour is kept for what needs a look.
          tone === 'wait' && 'text-wait',
          tone === 'danger' && 'text-danger',
          tone !== 'wait' && tone !== 'danger' && 'text-ink',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs leading-snug text-ink-3">{hint}</p>}
      {trend && <div className="mt-auto pt-1">{trend}</div>}
    </div>
  );
}

/** A stagger index for `rise` entries: each next item arrives a beat later. */
export const beat = (i: number): CSSProperties => ({ ['--i' as string]: i });

/** A person's or business's initials in a rounded square (not a circle: these are records). */
export function Initials({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const letters = name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w.match(/\p{L}/u)![0].toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-[10px] bg-brand-soft font-semibold text-brand-text ring-1 ring-brand/15 ring-inset',
        size === 'md' ? 'size-9 text-sm' : 'size-7 text-xs',
      )}
    >
      {letters || '·'}
    </span>
  );
}

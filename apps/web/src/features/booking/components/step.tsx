import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * One step of the booking page: a number, a heading, and — once chosen — a
 * one-line answer with "Change", so the page stays short as people go.
 */
export function Step({
  number,
  title,
  done,
  summary,
  onChange,
  children,
}: {
  number: number;
  title: string;
  /** Chosen, and folded away to its summary. */
  done?: boolean;
  summary?: ReactNode;
  onChange?: () => void;
  children?: ReactNode;
}) {
  const id = `step-${number}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 border-t border-line pt-6 first:border-t-0 first:pt-0"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold',
            done ? 'bg-ok text-surface' : 'bg-sunken text-ink-2',
          )}
        >
          {number}
        </span>
        <h2 id={id} className="text-xl tracking-[-0.02em] font-semibold text-ink">
          {title}
        </h2>
        {done && onChange && (
          <button
            type="button"
            onClick={onChange}
            className="ml-auto rounded-md px-2 py-1 text-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/25"
          >
            Change<span className="sr-only"> {title.toLowerCase()}</span>
          </button>
        )}
      </div>
      {done && summary ? <div className="pl-10 text-ink-2">{summary}</div> : children}
    </section>
  );
}

/** The look shared by every choice on the page (a card that shows it's picked). */
export const choiceCard = cn(
  'flex w-full items-start gap-3 rounded-md border border-line bg-surface p-3 text-left transition-colors',
  'hover:border-ink-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/25',
  'data-[state=checked]:border-brand data-[state=checked]:bg-brand-soft',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

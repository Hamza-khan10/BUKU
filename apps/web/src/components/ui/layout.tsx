import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Page width with comfortable gutters (16 px on phones). */
export function Container({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)} {...props} />;
}

/** A page heading block: an optional small label, the title, and a sentence of context. */
export function PageHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-2', className)}>
      {eyebrow && <p className="text-sm font-medium text-brand-ink">{eyebrow}</p>}
      <h1 className="text-[2rem] leading-[1.06] font-semibold tracking-[-0.03em] sm:text-[2.75rem]">
        {title}
      </h1>
      {description && <p className="max-w-2xl text-lg leading-relaxed text-ink-2">{description}</p>}
    </header>
  );
}

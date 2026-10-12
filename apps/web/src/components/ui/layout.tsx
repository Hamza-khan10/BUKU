import type { ComponentProps, ReactNode } from 'react';
import { RiseWords } from '@/components/motion/rise-words';
import { cn } from '@/lib/cn';

/** Page width with comfortable gutters (16 px on phones). */
export function Container({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)} {...props} />;
}

/**
 * The small label above a heading. Its Saffron dot is the logo's pivot: the one mark that
 * says "BUKU" on every page (D-095).
 */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-2 text-sm font-medium text-brand-ink', className)}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-spark" />
      {children}
    </p>
  );
}

/**
 * Every page's heading, the same everywhere (D-095): an optional label, the title, a sentence
 * of context, and room for an action or a way back. Plain-text titles rise in word by word,
 * as the home page's does (pure CSS; still under reduced motion). `compact` is for the
 * account area, where people move between pages often: smaller, and it simply fades up.
 */
export function PageHeading({
  eyebrow,
  title,
  description,
  back,
  aside,
  children,
  compact = false,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** A link back to where this page belongs ("← Precision Motors"). */
  back?: ReactNode;
  /** Something that sits beside the title (an icon, a picture). */
  aside?: ReactNode;
  /** Actions or controls under the heading. */
  children?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const words = typeof title === 'string' && !compact;
  return (
    <header className={cn('flex flex-col', compact ? 'rise-in gap-2 [--i:-4]' : 'gap-3 sm:gap-4', className)}>
      {back}
      {eyebrow && <Eyebrow className={cn(!compact && 'rise-in [--i:-4]')}>{eyebrow}</Eyebrow>}
      <div className={cn('flex items-center', aside && 'gap-4')}>
        {aside}
        <h1 className={compact ? 'type-app-title' : 'type-title'}>
          {words ? <RiseWords text={title} /> : title}
        </h1>
      </div>
      {description && (
        <p className={cn('type-lead max-w-2xl', !compact && 'rise-in [--i:-2]')}>{description}</p>
      )}
      {children && (
        <div className={cn('flex flex-col gap-4', !compact && 'rise-in [--i:-1] pt-1')}>{children}</div>
      )}
    </header>
  );
}

/** A section's heading, the same on every page: the title, and optionally a sentence and a link. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
  as: Tag = 'h2',
  size = 'section',
  className,
}: {
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: 'h2' | 'h3';
  /** `section` for pages that tell; `heading` for pages that do (lists, forms, panels). */
  size?: 'section' | 'heading';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <Tag id={id} className={cn(size === 'section' ? 'type-section max-w-3xl' : 'type-heading')}>
          {title}
        </Tag>
        {action}
      </div>
      {description && <p className="type-lead max-w-2xl">{description}</p>}
    </div>
  );
}

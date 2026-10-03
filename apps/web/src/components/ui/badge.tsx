import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Short status labels: "Confirmed", "Open now", "Not verified", "3 ahead". */
export const badgeStyles = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-ink-2',
        brand: 'bg-brand-soft text-brand-ink',
        ok: 'bg-ok-soft text-ok',
        wait: 'bg-wait-soft text-wait-ink',
        danger: 'bg-danger-soft text-danger',
        outline: 'border border-line text-ink-2',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}

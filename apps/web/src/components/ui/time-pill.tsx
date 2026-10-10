'use client';

import { RadioGroup } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Free times to pick from. Taken times simply aren't shown (no greyed-out
 * clutter); the chosen one fills emerald. A radio group underneath: Tab reaches
 * the group, arrow keys move between times, screen readers say "3 of 12".
 */
export function TimePills({
  label,
  className,
  ...props
}: ComponentProps<typeof RadioGroup.Root> & { label: string }) {
  return (
    <RadioGroup.Root aria-label={label} loop className={cn('flex flex-wrap gap-2', className)} {...props} />
  );
}

export function TimePill({ className, ...props }: ComponentProps<typeof RadioGroup.Item>) {
  return (
    <RadioGroup.Item
      className={cn(
        'tabular h-11 min-w-[5.5rem] rounded-full border border-line bg-surface px-4 text-[0.95rem] font-medium text-ink',
        'transition-[background-color,border-color,color,transform] duration-300 ease-(--ease-out) active:scale-[0.96] active:duration-100',
        'hover:border-brand hover:text-brand-ink',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-on-brand data-[state=checked]:shadow-soft',
        className,
      )}
      {...props}
    />
  );
}

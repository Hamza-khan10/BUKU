'use client';

import { Check } from 'lucide-react';
import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A checkbox with its label (the whole row is clickable; 44 px tall). */
export function Checkbox({
  label,
  description,
  className,
  ...props
}: ComponentProps<typeof RadixCheckbox.Root> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex min-h-11 items-start gap-3 py-1', className)}>
      <RadixCheckbox.Root
        id={id}
        aria-describedby={description ? `${id}-d` : undefined}
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border border-control bg-surface',
          'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-on-brand',
          'disabled:opacity-55',
        )}
        {...props}
      >
        <RadixCheckbox.Indicator>
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-[0.95rem] text-ink">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-sm text-ink-3">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** An on/off setting that takes effect immediately (use a checkbox inside forms that are submitted). */
export function Switch({
  label,
  description,
  className,
  ...props
}: ComponentProps<typeof RadixSwitch.Root> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4', className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-[0.95rem] text-ink">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-sm text-ink-3">
            {description}
          </p>
        )}
      </div>
      <RadixSwitch.Root
        id={id}
        aria-describedby={description ? `${id}-d` : undefined}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full bg-control transition-colors duration-150',
          'data-[state=checked]:bg-ok disabled:opacity-55',
        )}
        {...props}
      >
        <RadixSwitch.Thumb className="block size-6 translate-x-0.5 rounded-full bg-surface shadow-soft transition-transform duration-150 data-[state=checked]:translate-x-[1.375rem]" />
      </RadixSwitch.Root>
    </div>
  );
}

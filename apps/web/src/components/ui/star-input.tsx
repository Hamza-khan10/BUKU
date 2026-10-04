'use client';

import { Star } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * Choosing 1–5 stars: a radio group (arrow keys move, each star read out with
 * its word — "4 stars, Very good"), drawn as stars filled up to the choice.
 * The word for the chosen value is shown too, so a rating is never ambiguous.
 */
export function StarInput({
  label,
  value,
  onChange,
  words,
  size = 'md',
  invalid,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number) => void;
  words: readonly string[];
  size?: 'md' | 'sm';
  invalid?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RadioGroup.Root
        value={value ? String(value) : ''}
        onValueChange={(v) => onChange(Number(v))}
        aria-label={label}
        aria-invalid={invalid || undefined}
        orientation="horizontal"
        className="flex gap-1"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <RadioGroup.Item
            key={n}
            value={String(n)}
            aria-label={`${n} ${n === 1 ? 'star' : 'stars'}, ${words[n - 1]}`}
            className={cn(
              'grid place-items-center rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus/25',
              size === 'md' ? 'size-11' : 'size-9',
            )}
          >
            <Star
              aria-hidden
              className={cn(
                size === 'md' ? 'size-8' : 'size-6',
                value && n <= value ? 'fill-wait text-wait' : 'text-control',
              )}
            />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {value ? <span className="text-sm font-medium text-ink-2">{words[value - 1]}</span> : null}
    </div>
  );
}

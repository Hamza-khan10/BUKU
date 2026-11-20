import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/**
 * The held dot (Brand Identity v1.0, D-143): the logo's Saffron dot used as a full stop, once per
 * layout, on the line that matters. Decorative: the sentence reads the same without it, so screen
 * readers skip it, and as a shape (not a coloured "." in the text) it never counts as faint text.
 * In a headline it drops into place after word `after`, the way the dot lands in the cup; `still`
 * where nobody sees the page open (the footer).
 */
export function HeldDot({
  after = 0,
  still = false,
  className,
}: {
  after?: number;
  still?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('held-dot', still && 'held-dot-still', className)}
      style={{ '--i': after } as CSSProperties}
    />
  );
}

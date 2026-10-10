import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ratingValue } from '@/lib/format';

/**
 * Five stars filled to the average (4.5 → four and a half). The stars are
 * decoration; the text says the number for everyone.
 */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex', className)}>
      <span className="flex text-line">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className="size-[1em] fill-current" />
        ))}
      </span>
      <span
        className="absolute inset-0 flex overflow-hidden text-ink"
        style={{ width: `${(value / 5) * 100}%` }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className="size-[1em] shrink-0 fill-current" />
        ))}
      </span>
    </span>
  );
}

/** "★★★★½ 4.5 (2 reviews)", or, honestly, "No reviews yet". */
export function RatingInline({
  average,
  count,
  className,
}: {
  average: number;
  count: number;
  className?: string;
}) {
  if (count === 0) return <span className={cn('text-sm text-ink-3', className)}>No reviews yet</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <Stars value={average} />
      <span className="font-semibold text-ink">{ratingValue(average)}</span>
      <span className="text-ink-3">
        ({count} {count === 1 ? 'review' : 'reviews'})
      </span>
    </span>
  );
}

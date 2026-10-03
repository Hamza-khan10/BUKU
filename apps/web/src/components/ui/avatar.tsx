import { cn } from '@/lib/cn';

/** Up to two initials from a name, in any script ("Ayesha Khan" → "AK", "عائشہ خان" → "عخ"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.map((w) => [...w][0] ?? '');
  return (letters.length > 1 ? letters[0]! + letters.at(-1)! : (letters[0] ?? '')).toUpperCase();
}

/**
 * A person or business picture, with initials when there's none. Pictures are
 * signed links from the API, so a plain <img> (the optimiser can't cache links
 * that expire).
 */
export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name: string;
  src?: string | null | undefined;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-soft font-semibold text-brand-ink',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {src ? (
        <img src={src} alt="" width={size} height={size} className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

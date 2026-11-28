import type { Route } from 'next';
import Link from 'next/link';
import type { City } from '@/features/search/types';
import { cn } from '@/lib/cn';

/** The cities with places on BUKU, as a row of pills: the chosen one marked, the others a tap away. */
export function CityPicker({ list, current }: { list: City[]; current: string }) {
  if (list.length < 2) return null;
  return (
    <nav
      aria-label="Choose a city"
      className="inline-flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-sunken p-1"
    >
      {list.slice(0, 8).map((c) => {
        const on = c.city.toLowerCase() === current.toLowerCase();
        return (
          <Link
            key={`${c.city}-${c.country}`}
            href={`/?city=${encodeURIComponent(c.city)}` as Route}
            scroll={false}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'inline-flex h-9 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-200',
              on ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink',
            )}
          >
            {c.city}
          </Link>
        );
      })}
    </nav>
  );
}

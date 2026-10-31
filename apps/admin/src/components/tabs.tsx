import type { Route } from 'next';
import Link from 'next/link';
import { cx } from './ui';

/**
 * A list's views (by status), as a segmented control: one row of links, the current one raised.
 * Plain links, so each view has its own address and works without scripts.
 */
export function Tabs({
  label,
  items,
}: {
  label: string;
  items: { href: Route; label: string; current: boolean }[];
}) {
  return (
    <nav
      aria-label={label}
      className="rise mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-sunken p-1 ring-1 ring-line ring-inset"
    >
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.current ? 'page' : undefined}
          className={cx(
            'press flex h-8 shrink-0 items-center rounded-lg px-3 text-sm font-medium',
            t.current
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(var(--shadow-color)/0.2)] ring-1 ring-line-strong ring-inset'
              : 'text-ink-2 hover:text-ink',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

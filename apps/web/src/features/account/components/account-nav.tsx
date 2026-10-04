'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

/** The account area's own pages (more join as they're built: reviews, notifications, settings). */
const PAGES: { href: Route; label: string }[] = [
  { href: '/account', label: 'Overview' },
  { href: '/account/appointments', label: 'Visits' },
  { href: '/account/reviews', label: 'Reviews' },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Your account" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line">
      {PAGES.map(({ href, label }) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'relative shrink-0 px-3 py-3 text-sm font-medium text-ink-2 hover:text-ink',
              'after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full',
              current && 'text-ink after:bg-brand',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

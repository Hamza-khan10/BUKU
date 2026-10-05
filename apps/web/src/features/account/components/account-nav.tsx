'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

/** The account area's own pages. */
const PAGES: { href: Route; label: string }[] = [
  { href: '/account', label: 'Overview' },
  { href: '/account/appointments', label: 'Visits' },
  { href: '/account/reviews', label: 'Reviews' },
  { href: '/account/notifications', label: 'Notifications' },
  { href: '/account/plan', label: 'Plan' },
  { href: '/account/settings', label: 'Settings' },
];

export function AccountNav() {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  // On a narrow screen the tabs scroll sideways: keep the current one in view.
  useEffect(() => {
    const strip = nav.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !current) return;
    // Centred where it can be (the browser stops at either end).
    strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);
  return (
    <nav
      ref={nav}
      aria-label="Your account"
      className="relative -mx-1 flex gap-1 overflow-x-auto border-b border-line"
    >
      {PAGES.map(({ href, label }) => {
        const current =
          href === '/account' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
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

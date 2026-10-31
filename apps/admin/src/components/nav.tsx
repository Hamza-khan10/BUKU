'use client';

import { Activity, Flag, LayoutDashboard, Power, ShieldCheck, Store, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Item {
  href: Route;
  label: string;
  icon: LucideIcon;
}

/** The console's sections. Only what exists is listed; the rest arrives with its pages. */
const SECTIONS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ href: '/', label: 'Overview', icon: LayoutDashboard }] },
  {
    title: 'Operations',
    items: [
      { href: '/businesses', label: 'Businesses', icon: Store },
      { href: '/reports', label: 'Reports', icon: Flag },
    ],
  },
  { title: 'Watch', items: [{ href: '/monitoring', label: 'Monitoring', icon: Activity }] },
  {
    title: 'Security',
    items: [
      { href: '/security/switches', label: 'Emergency switches', icon: Power },
      { href: '/security/access', label: 'Access review', icon: ShieldCheck },
    ],
  },
];

const cx = (...c: (string | false)[]) => c.filter(Boolean).join(' ');

export function Nav() {
  const path = usePathname();
  const current = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
  return (
    <nav aria-label="Console" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-5 lg:overflow-visible">
      {SECTIONS.map((section) => (
        <div key={section.title ?? 'top'} className="flex gap-1 lg:flex-col">
          {section.title && (
            <p className="hidden px-3 pb-1 text-[0.7rem] font-semibold tracking-[0.08em] text-ink-3 uppercase lg:block">
              {section.title}
            </p>
          )}
          {section.items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={current(href) ? 'page' : undefined}
              className={cx(
                'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                current(href) ? 'bg-brand-soft text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink',
              )}
            >
              <Icon aria-hidden className={cx('size-4', current(href) ? 'text-brand' : 'text-ink-3')} />
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

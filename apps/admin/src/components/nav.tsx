'use client';

import {
  Activity,
  BellRing,
  CreditCard,
  Flag,
  LayoutDashboard,
  MessageSquareWarning,
  Power,
  ScrollText,
  ShieldCheck,
  Store,
  UserSearch,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

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
      { href: '/reviews', label: 'Reviews', icon: MessageSquareWarning },
      { href: '/accounts', label: 'Accounts', icon: UserSearch },
      { href: '/billing', label: 'Billing', icon: CreditCard },
    ],
  },
  { title: 'Watch', items: [{ href: '/monitoring', label: 'Monitoring', icon: Activity }] },
  { title: 'Settings', items: [{ href: '/settings/notifications', label: 'Notifications', icon: BellRing }] },
  {
    title: 'Security',
    items: [
      { href: '/security/switches', label: 'Emergency switches', icon: Power },
      { href: '/security/audit', label: 'Audit log', icon: ScrollText },
      { href: '/security/access', label: 'Access review', icon: ShieldCheck },
    ],
  },
];

/**
 * The console's sections. The highlight glides to the page you open (a critically damped spring:
 * it arrives without bouncing), so the eye follows where you went.
 */
export function Nav() {
  const path = usePathname();
  const current = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
  return (
    <nav
      aria-label="Console"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0"
    >
      {SECTIONS.map((section) => (
        <div key={section.title ?? 'top'} className="flex gap-1 lg:flex-col lg:gap-0.5">
          {section.title && (
            <p className="hidden px-3 pb-1.5 text-xs font-medium text-ink-3 lg:block">{section.title}</p>
          )}
          {section.items.map(({ href, label, icon: Icon }) => {
            const active = current(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'press relative flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium',
                  active ? 'text-ink' : 'text-ink-2 hover:bg-raised/70 hover:text-ink',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    aria-hidden
                    className="absolute inset-0 rounded-[10px] bg-brand-soft ring-1 ring-brand/25 ring-inset"
                    transition={{ type: 'spring', bounce: 0, duration: 0.38 }}
                  />
                )}
                <Icon
                  aria-hidden
                  strokeWidth={1.9}
                  className={cx('relative size-[1.05rem]', active ? 'text-brand-text' : 'text-ink-3')}
                />
                <span className="relative">{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

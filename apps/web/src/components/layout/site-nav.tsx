'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as RadixDialog } from 'radix-ui';
import { useState } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/theme';
import { primaryNav, secondaryNav } from './nav';

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Links in the header (from `md`), with the current page marked for everyone, screen readers included. */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {primaryNav.map(({ href, label }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2 text-[0.95rem] font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink',
                  current && 'text-ink',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The menu on phones: a full-height sheet, closed by Escape, the button or choosing a page. */
export function MobileNav({ theme }: { theme: Theme }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger
        className="grid size-11 place-items-center rounded-md text-ink hover:bg-sunken md:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-6" aria-hidden />
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-night/50 md:hidden" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(22rem,100vw)] flex-col bg-canvas shadow-lift animate-rise md:hidden"
        >
          <div className="flex h-16 items-center justify-between border-b border-line px-4">
            <RadixDialog.Title className="flex items-center gap-2 font-display text-lg font-bold">
              <LogoMark className="size-7" /> Menu
            </RadixDialog.Title>
            <RadixDialog.Close
              className="grid size-11 place-items-center rounded-md hover:bg-sunken"
              aria-label="Close menu"
            >
              <X className="size-6" aria-hidden />
            </RadixDialog.Close>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto p-4">
            <ul className="flex flex-col gap-1">
              {primaryNav.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={isCurrent(pathname, href) ? 'page' : undefined}
                    className="flex h-12 items-center rounded-md px-3 text-lg font-medium text-ink hover:bg-sunken aria-[current=page]:bg-sunken"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-4">
              {secondaryNav.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={isCurrent(pathname, href) ? 'page' : undefined}
                    className="flex h-11 items-center rounded-md px-3 text-ink-2 hover:bg-sunken hover:text-ink aria-[current=page]:text-ink"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center justify-between border-t border-line p-4">
            <span className="text-sm text-ink-2">Theme</span>
            <ThemeToggle initial={theme} />
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

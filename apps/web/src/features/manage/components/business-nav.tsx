'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { can, fetchManaged, managedKey } from '../api';

/**
 * A business's own pages, as tabs (the same look as the account area's). Each person sees only
 * the tabs their role can use; the API refuses the rest anyway.
 */
export function BusinessNav({ id }: { id: string }) {
  const pathname = usePathname();
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (!business.isSuccess) return null;
  const role = business.data.myRole;
  const pages = [
    { href: `/business/${id}`, label: 'Today', show: true },
    { href: `/business/${id}/appointments`, label: 'Appointments', show: true },
    { href: `/business/${id}/check-in`, label: 'Check-in', show: true },
    { href: `/business/${id}/services`, label: 'Services', show: can(role, 'services.manage') },
    { href: `/business/${id}/team`, label: 'Team', show: can(role, 'staff.manage') },
  ].filter((p) => p.show);
  if (pages.length < 2) return null;
  return (
    <nav
      aria-label={business.data.name}
      className="relative -mx-1 flex gap-1 overflow-x-auto border-b border-line"
    >
      {pages.map(({ href, label }) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href as Route}
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

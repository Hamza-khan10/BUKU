'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, LayoutGrid } from 'lucide-react';
import { motion } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/components/motion/use-reduced-motion';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CategoryIcon } from '@/features/categories/icons';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { fetchManaged, managedKey, type BusinessStatus, type ManagedBusiness } from '../api';
import { businessPages, currentPage, type PageGroup } from '../navigation';

/** Where the business stands with BUKU, in words (never colour alone). */
const STANDING: Record<BusinessStatus, { label: string; dot: string }> = {
  verified: { label: 'Verified', dot: 'bg-ok' },
  pending: { label: 'Not verified yet', dot: 'bg-wait' },
  rejected: { label: 'Not approved', dot: 'bg-danger' },
  suspended: { label: 'Suspended', dot: 'bg-danger' },
};

/**
 * A business's own pages (D-095's one design language, redrawn for 3.5's fifteen pages). On a
 * wide screen, a rail beside the page: the business, then its pages in four groups, with a
 * highlight that glides to where you went (a critically damped spring: it arrives without
 * bouncing). On a phone, one glass bar under the header says where you are; "All pages" opens a
 * sheet of every page as a tile. Nothing scrolls sideways.
 */
export function BusinessNav({ id }: { id: string }) {
  const pathname = usePathname();
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  // The rail's column is held while the business loads, so the page doesn't jump sideways.
  if (!business.isSuccess)
    return (
      <div aria-hidden className="hidden lg:block">
        {business.isPending && <Skeleton className="h-[30rem] rounded-2xl" />}
      </div>
    );
  const groups = businessPages(id, business.data.myRole);
  const here = currentPage(groups, pathname);
  return (
    <>
      <PhoneBar business={business.data} groups={groups} here={here} pathname={pathname} />
      <Rail business={business.data} groups={groups} pathname={pathname} />
    </>
  );
}

function Identity({ business, compact = false }: { business: ManagedBusiness; compact?: boolean }) {
  const standing = STANDING[business.status];
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className={cn(
          'grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-brand-soft text-brand-ink',
          compact ? 'size-8' : 'size-10',
        )}
      >
        {business.logoUrl ? (
          <img src={business.logoUrl} alt="" className="size-full object-cover" />
        ) : (
          <CategoryIcon slug={business.category.slug} className={compact ? 'size-4' : 'size-5'} />
        )}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span title={business.name} className="truncate text-sm font-semibold text-ink">
          {business.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', standing.dot)} />
          {standing.label}
        </span>
      </span>
    </span>
  );
}

/** Wide screens: the business, then its pages by group; the rail stays in view as the page scrolls. */
function Rail({
  business,
  groups,
  pathname,
}: {
  business: ManagedBusiness;
  groups: PageGroup[];
  pathname: string;
}) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  // On a short window the rail scrolls on its own; the page you're on is always in view in it
  // (scrolling the rail only, never the page).
  useEffect(() => {
    const rail = box.current;
    const active = rail?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!rail || !active) return;
    const top = active.getBoundingClientRect().top - rail.getBoundingClientRect().top + rail.scrollTop;
    if (top < rail.scrollTop || top + active.offsetHeight > rail.scrollTop + rail.clientHeight)
      rail.scrollTop = top - rail.clientHeight / 2 + active.offsetHeight / 2;
  }, [pathname]);
  return (
    // The rail itself sticks (not a box inside it), so it stays beside the page as it scrolls.
    <nav aria-label={business.name} className="sticky top-24 hidden self-start lg:block">
      <div
        ref={box}
        data-lenis-prevent
        className="relative flex max-h-[calc(100dvh-7.5rem)] flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-line/70 bg-surface/75 p-2.5 shadow-soft backdrop-blur-xl"
      >
        {/* The business it is, and the way back to all of them. */}
        <div className="flex items-center justify-between gap-2 p-2">
          <Identity business={business} />
          <Link
            href="/business"
            aria-label="Your businesses"
            title="Your businesses"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            <ArrowLeftRight aria-hidden className="size-4" strokeWidth={1.9} />
          </Link>
        </div>
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <p className="px-3 pb-0.5 text-xs font-medium text-ink-3">{g.title}</p>
            <ul className="flex flex-col gap-px">
              {g.pages.map(({ href, label, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href as Route}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex h-8 items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium transition-colors active:scale-[0.98]',
                        active ? 'text-ink' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink',
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId={`business-nav-${business.id}`}
                          aria-hidden
                          className="absolute inset-0 rounded-[10px] bg-brand-soft ring-1 ring-brand/20 ring-inset"
                          transition={
                            reduced ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.38 }
                          }
                        />
                      )}
                      <Icon
                        aria-hidden
                        strokeWidth={1.9}
                        className={cn('relative size-4 shrink-0', active ? 'text-brand-ink' : 'text-ink-3')}
                      />
                      <span className="relative">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * Phones and tablets: one glass bar under the header with the page you're on, and "All pages",
 * which opens a sheet from the bottom (where the thumb is) with every page as a tile, by group.
 */
function PhoneBar({
  business,
  groups,
  here,
  pathname,
}: {
  business: ManagedBusiness;
  groups: PageGroup[];
  here: ReturnType<typeof currentPage>;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = here?.page.icon;
  return (
    <nav
      aria-label={business.name}
      className="sticky top-16 z-20 -mx-4 border-b border-line/60 bg-canvas/80 px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:hidden"
    >
      <div className="flex items-center justify-between gap-3">
        {here && Icon ? (
          <Link
            href={here.page.href as Route}
            aria-current="page"
            className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pr-2"
          >
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-brand-ink"
            >
              <Icon className="size-[1.1rem]" strokeWidth={1.9} />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs text-ink-3">{business.name}</span>
              <span className="truncate text-[0.95rem] font-semibold text-ink">{here.page.label}</span>
            </span>
          </Link>
        ) : (
          <Identity business={business} compact />
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink shadow-soft transition-transform active:scale-[0.97]">
            <LayoutGrid aria-hidden className="size-4" strokeWidth={1.9} />
            All pages
          </DialogTrigger>
          <DialogContent title={business.name} description={STANDING[business.status].label}>
            <div className="flex flex-col gap-5">
              {groups.map((g) => (
                <section key={g.title} aria-label={g.title} className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium text-ink-3">{g.title}</h3>
                  <ul className="grid grid-cols-3 gap-2">
                    {g.pages.map(({ href, label, icon: TileIcon }) => {
                      const active = pathname === href;
                      return (
                        <li key={href}>
                          <Link
                            href={href as Route}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => setOpen(false)}
                            className={cn(
                              'flex h-full min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl p-2 text-center text-xs font-medium transition-[transform,background-color] active:scale-[0.97]',
                              active
                                ? 'bg-brand-soft text-brand-ink ring-1 ring-brand/25 ring-inset'
                                : 'bg-sunken/70 text-ink hover:bg-sunken',
                            )}
                          >
                            <TileIcon aria-hidden className="size-5" strokeWidth={1.8} />
                            {label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </nav>
  );
}

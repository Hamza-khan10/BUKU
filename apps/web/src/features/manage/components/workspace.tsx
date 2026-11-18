'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronsUpDown,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DropdownMenu, Tooltip as RadixTooltip } from 'radix-ui';
import { LogoMark } from '@/components/brand/logo';
import { useReducedMotion } from '@/components/motion/use-reduced-motion';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { CategoryIcon } from '@/features/categories/icons';
import { AccountControl } from '@/features/auth/components/account-control';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/theme';
import {
  can,
  fetchManaged,
  fetchMine,
  managedKey,
  MINE_KEY,
  ROLE_LABELS,
  type BusinessStatus,
  type ManagedBusiness,
} from '../api';
import { businessPages, type BusinessPage, type PageGroup } from '../navigation';

/** Where the business stands with BUKU, in words beside a dot (the dot is state, never alone). */
const STANDING: Record<BusinessStatus, { label: string; dot: string }> = {
  verified: { label: 'Verified', dot: 'bg-ok' },
  pending: { label: 'Not verified yet', dot: 'bg-wait' },
  rejected: { label: 'Not approved', dot: 'bg-danger' },
  suspended: { label: 'Suspended', dot: 'bg-danger' },
};

/** The four pages a phone keeps at the thumb: the day, its bookings, the camera, the line. */
const PHONE_TABS = ['', '/appointments', '/check-in', '/queue'];

const RAIL_KEY = 'buku:workspace-rail';

/**
 * A business's workspace (D-133): the business's pages as an app, using the whole window. A
 * slim bar on top (the business, with a switcher to your others; your public page; theme;
 * account), a sidebar flush to the left with the pages in four groups (it folds to icons when
 * you want the room), and the page beside it at full width. On a phone, tabs at the bottom for
 * the four pages used all day, and "More" for the rest.
 */
export function Workspace({
  id,
  theme,
  signedIn,
  children,
}: {
  id: string;
  theme: Theme;
  signedIn: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const business = useQuery({
    queryKey: managedKey(id),
    queryFn: () => fetchManaged(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const [folded, setFolded] = useFolded();
  const groups = business.data ? businessPages(id, business.data.myRole) : null;

  return (
    <div className="min-h-dvh">
      <header className="material-bar sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line/60 px-3 sm:px-4">
        <button
          type="button"
          onClick={() => setFolded(!folded)}
          aria-label={folded ? 'Show the menu' : 'Fold the menu'}
          aria-expanded={!folded}
          className="hidden size-9 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink lg:grid"
        >
          {folded ? (
            <PanelLeftOpen aria-hidden className="size-[1.1rem]" strokeWidth={1.9} />
          ) : (
            <PanelLeftClose aria-hidden className="size-[1.1rem]" strokeWidth={1.9} />
          )}
        </button>
        <Link href="/" aria-label="BUKU home" className="shrink-0 rounded-md">
          <LogoMark className="size-8" />
        </Link>
        <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line" />
        {business.data ? <Switcher business={business.data} /> : <span className="h-9 w-48" />}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {business.data && (business.data.status === 'pending' || business.data.status === 'verified') && (
            <Link
              href={`/b/${business.data.slug}` as Route}
              className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink md:inline-flex"
            >
              Your page
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          )}
          <ThemeToggle initial={theme} className="hidden lg:inline-flex" />
          <AccountControl signedIn={signedIn} />
        </div>
      </header>

      {groups && business.data && (
        <Sidebar business={business.data} groups={groups} pathname={pathname} folded={folded} />
      )}

      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'px-4 pt-6 pb-28 focus:outline-none sm:px-6 lg:pt-8 lg:pr-10 lg:pb-14',
          folded ? 'lg:pl-[calc(4.75rem+2.5rem)]' : 'lg:pl-[calc(15.5rem+2.5rem)]',
        )}
      >
        <div className="flex w-full max-w-[100rem] flex-col gap-8">{children}</div>
      </main>

      {groups && business.data && <PhoneTabs business={business.data} groups={groups} pathname={pathname} />}
    </div>
  );
}

/** Whether the sidebar is folded to icons: this person's choice, remembered on this device. */
const foldListeners = new Set<() => void>();
/** This visit's choice, when the browser can't keep it (private window, blocked storage). */
let foldedNow: boolean | null = null;

function readFolded(): boolean {
  if (foldedNow !== null) return foldedNow;
  try {
    return window.localStorage.getItem(RAIL_KEY) === 'folded';
  } catch {
    return false;
  }
}

function useFolded(): [boolean, (folded: boolean) => void] {
  const folded = useSyncExternalStore(
    (onChange) => {
      foldListeners.add(onChange);
      return () => foldListeners.delete(onChange);
    },
    readFolded,
    () => false,
  );
  const set = (next: boolean) => {
    foldedNow = next;
    try {
      window.localStorage.setItem(RAIL_KEY, next ? 'folded' : 'open');
    } catch {
      // Remembered for this visit only.
    }
    foldListeners.forEach((l) => l());
  };
  return [folded, set];
}

function BusinessMark({ business, className }: { business: ManagedBusiness; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-lg bg-brand-soft text-brand-ink',
        className,
      )}
    >
      {business.logoUrl ? (
        <img src={business.logoUrl} alt="" className="size-full object-cover" />
      ) : (
        <CategoryIcon slug={business.category.slug} className="size-[55%]" />
      )}
    </span>
  );
}

/** The business you're in, and a menu to go to another of yours or add one. */
function Switcher({ business }: { business: ManagedBusiness }) {
  const [open, setOpen] = useState(false);
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: fetchMine, enabled: open });
  const standing = STANDING[business.status];
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pr-2 pl-1 text-left transition-colors outline-none hover:bg-sunken/80 focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-sunken">
        <BusinessMark business={business} className="size-8" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-ink">{business.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', standing.dot)} />
            {standing.label}
          </span>
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-3" />
        <span className="sr-only">: switch business</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 w-72 rounded-2xl border border-line bg-surface p-1.5 shadow-lift animate-rise"
        >
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-ink-3">
            Your businesses
          </DropdownMenu.Label>
          {(mine.data ?? [business]).map((b) => (
            <DropdownMenu.Item key={b.id} asChild>
              <Link
                href={`/business/${b.id}` as Route}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 outline-none data-[highlighted]:bg-sunken"
              >
                <BusinessMark business={b} className="size-7" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-sm font-medium text-ink">{b.name}</span>
                  <span className="text-xs text-ink-3">{ROLE_LABELS[b.myRole]}</span>
                </span>
                {b.id === business.id && <Check aria-label="You’re here" className="size-4 text-brand-ink" />}
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1.5 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link
              href="/business"
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-ink-2 outline-none data-[highlighted]:bg-sunken data-[highlighted]:text-ink"
            >
              <Store aria-hidden className="size-4" />
              All your businesses
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link
              href="/business/new"
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-ink-2 outline-none data-[highlighted]:bg-sunken data-[highlighted]:text-ink"
            >
              <Plus aria-hidden className="size-4" />
              Add a business
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Wide screens: the pages, flush to the left, full height. Folded, only the icons stay (each
 * names itself on hover and focus). The highlight glides to the page you open (a critically
 * damped spring; still under reduced motion).
 */
function Sidebar({
  business,
  groups,
  pathname,
  folded,
}: {
  business: ManagedBusiness;
  groups: PageGroup[];
  pathname: string;
  folded: boolean;
}) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  // On a short window the menu scrolls on its own; the page you're on stays in view in it.
  useEffect(() => {
    const menu = box.current;
    const active = menu?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!menu || !active) return;
    const top = active.getBoundingClientRect().top - menu.getBoundingClientRect().top + menu.scrollTop;
    if (top < menu.scrollTop || top + active.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = top - menu.clientHeight / 2 + active.offsetHeight / 2;
  }, [pathname]);
  const verifyHref = `/business/${business.id}/verification`;
  const needsVerifying = business.status !== 'verified' && can(business.myRole, 'business.legal');

  return (
    <nav
      aria-label={business.name}
      className={cn(
        'fixed top-14 bottom-0 left-0 z-20 hidden flex-col border-r border-line/70 bg-surface/60 backdrop-blur-xl lg:flex',
        folded ? 'w-[4.75rem]' : 'w-[15.5rem]',
      )}
    >
      <div
        ref={box}
        data-lenis-prevent
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-3 py-5"
      >
        <RadixTooltip.Provider delayDuration={200}>
          {groups.map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              {folded ? (
                <span aria-hidden className="mx-auto mb-1 h-px w-6 bg-line first:hidden" />
              ) : (
                <p className="px-3 pb-1 text-xs font-medium text-ink-3">{g.title}</p>
              )}
              <ul className="flex flex-col gap-0.5">
                {g.pages.map((p) => (
                  <li key={p.href}>
                    <SideLink
                      page={p}
                      active={pathname === p.href}
                      folded={folded}
                      reduced={reduced}
                      id={business.id}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </RadixTooltip.Provider>
      </div>
      {needsVerifying && !folded && (
        <Link
          href={verifyHref as Route}
          className="m-3 flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-soft transition-colors hover:border-control"
        >
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-wait-soft text-wait-ink"
          >
            <ShieldCheck className="size-4" strokeWidth={1.9} />
          </span>
          <span className="flex flex-col gap-0.5 leading-snug">
            <span className="text-sm font-semibold text-ink">
              {business.status === 'rejected' ? 'See why it wasn’t approved' : 'Get verified'}
            </span>
            <span className="text-xs text-ink-3">
              Customers see “Not verified” until BUKU checks your details.
            </span>
          </span>
        </Link>
      )}
    </nav>
  );
}

function SideLink({
  page: { href, label, icon: Icon },
  active,
  folded,
  reduced,
  id,
}: {
  page: BusinessPage;
  active: boolean;
  folded: boolean;
  reduced: boolean;
  id: string;
}) {
  const link = (
    <Link
      href={href as Route}
      aria-current={active ? 'page' : undefined}
      aria-label={folded ? label : undefined}
      className={cn(
        'relative flex h-9 items-center gap-3 rounded-xl text-sm font-medium transition-colors active:scale-[0.98]',
        folded ? 'justify-center px-0' : 'px-3',
        active ? 'text-ink' : 'text-ink-2 hover:bg-sunken/80 hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId={`workspace-side-${id}`}
          aria-hidden
          className="absolute inset-0 rounded-xl bg-brand-soft ring-1 ring-brand/20 ring-inset"
          transition={reduced ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.36 }}
        />
      )}
      <Icon
        aria-hidden
        strokeWidth={1.9}
        className={cn('relative size-[1.1rem] shrink-0', active ? 'text-brand-ink' : 'text-ink-3')}
      />
      {!folded && <span className="relative truncate">{label}</span>}
    </Link>
  );
  if (!folded) return link;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{link}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="right"
          sideOffset={10}
          className="z-50 rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-canvas shadow-lift"
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/**
 * Phones: tabs at the bottom, where the thumb is, for the four pages used all day; "More" opens a
 * sheet with every page as a tile, by group. The tab of the page you're on is lit (or More, for
 * a page that lives there).
 */
function PhoneTabs({
  business,
  groups,
  pathname,
}: {
  business: ManagedBusiness;
  groups: PageGroup[];
  pathname: string;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.pages);
  const tabs = PHONE_TABS.map((path) => all.find((p) => p.href === `/business/${business.id}${path}`)).filter(
    (p): p is BusinessPage => p !== undefined,
  );
  const elsewhere = !tabs.some((t) => t.href === pathname);
  const lit = (on: boolean) =>
    on && (
      <motion.span
        layoutId={`workspace-tab-${business.id}`}
        aria-hidden
        className="absolute inset-x-2 top-1 h-8 rounded-full bg-brand-soft"
        transition={reduced ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.32 }}
      />
    );
  return (
    <nav
      aria-label={business.name}
      data-bottom-bar
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgb(var(--shadow-color)/0.06)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href as Route}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium transition-transform active:scale-95',
                  active ? 'text-brand-ink' : 'text-ink-2',
                )}
              >
                {lit(active)}
                <Icon aria-hidden className="relative mt-0.5 size-5" strokeWidth={active ? 2.1 : 1.8} />
                <span className="relative">{label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              className={cn(
                'relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.7rem] font-medium transition-transform active:scale-95',
                elsewhere ? 'text-brand-ink' : 'text-ink-2',
              )}
            >
              {lit(elsewhere)}
              <LayoutGrid
                aria-hidden
                className="relative mt-0.5 size-5"
                strokeWidth={elsewhere ? 2.1 : 1.8}
              />
              <span className="relative">More</span>
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
                                'flex h-full min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl p-2 text-center text-xs font-medium transition-[transform,background-color] active:scale-[0.97]',
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
                {(business.status === 'pending' || business.status === 'verified') && (
                  <Link
                    href={`/b/${business.slug}` as Route}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-center gap-1.5 rounded-full border border-line py-2.5 text-sm font-medium text-ink"
                  >
                    Your page
                    <ArrowUpRight aria-hidden className="size-4" />
                  </Link>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </li>
      </ul>
    </nav>
  );
}

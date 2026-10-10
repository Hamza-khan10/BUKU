'use client';

import { removeDisallowed } from '@buku/validation';
import { Building2, Search, Tag, Wrench } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { createElement, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api/client';
import type { Suggestions } from '../types';

interface Option {
  key: string;
  kind: 'business' | 'category' | 'service';
  label: string;
  detail?: string;
  href: string;
}

const ICONS = { business: Building2, category: Tag, service: Wrench } as const;

function optionsFrom(s: Suggestions): Option[] {
  return [
    ...s.businesses.map((b) => ({
      key: `b-${b.id}`,
      kind: 'business' as const,
      label: b.name,
      detail: `${b.category} · ${b.city}`,
      href: `/b/${b.slug}`,
    })),
    ...s.categories.map((c) => ({
      key: `c-${c.slug}`,
      kind: 'category' as const,
      label: c.name,
      href: `/c/${c.slug}`,
    })),
    ...s.services.map((name) => ({
      key: `s-${name}`,
      kind: 'service' as const,
      label: name,
      href: `/explore?q=${encodeURIComponent(name)}`,
    })),
  ];
}

/**
 * Search, with suggestions as you type (businesses, categories, services).
 * An accessible combobox: arrow keys move through suggestions, Enter opens
 * one (or searches the words), Escape closes. Underneath it's a plain form
 * to /explore, so it works before scripts load too.
 */
export function SearchBox({
  defaultValue = '',
  city,
  size = 'lg',
  autoFocus,
}: {
  defaultValue?: string;
  city?: string | undefined;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [value, setValue] = useState(defaultValue);
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<Suggestions>('businesses/autocomplete', { query: { q, limit: 5 }, signal: controller.signal })
        .then((s) => {
          setOptions(optionsFrom(s));
          setActive(-1);
        })
        .catch(() => setOptions([])); // Suggestions are a help, never a blocker.
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href as Route);
  };

  const submit = () => {
    const q = value.trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (city) params.set('city', city);
    const qs = params.toString();
    go(`/explore${qs ? `?${qs}` : ''}`);
  };

  // Suggestions need two characters; older ones are never shown for a shorter entry.
  const shown = value.trim().length >= 2 ? options : [];

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const visible = open && shown.length > 0;
    if (e.key === 'ArrowDown' && shown.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % shown.length);
    } else if (e.key === 'ArrowUp' && visible) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? shown.length - 1 : a - 1));
    } else if (e.key === 'Escape' && visible) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'Enter' && visible && active >= 0) {
      e.preventDefault();
      go(shown[active]!.href);
    }
  };

  const showList = open && shown.length > 0;
  const big = size === 'lg';

  return (
    <form
      role="search"
      action="/explore"
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative w-full"
    >
      <label htmlFor={`${id}-input`} className="sr-only">
        Search for a business, service or category
      </label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border border-control bg-surface pr-1.5 pl-5 shadow-soft transition-[border-color,box-shadow] duration-200 focus-within:border-focus focus-within:ring-4 focus-within:ring-focus/15',
          big ? 'h-16' : 'h-12',
        )}
      >
        <Search className="size-5 shrink-0 text-ink-3" aria-hidden />
        <input
          id={`${id}-input`}
          name="q"
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          // Only where searching is the page's whole purpose (the explore page).
          autoFocus={autoFocus}
          placeholder="Haircut, dentist…"
          value={value}
          onChange={(e) => {
            setValue(removeDisallowed(e.target.value, 'line'));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden',
            big ? 'text-lg' : 'text-base',
          )}
        />
        {city && <input type="hidden" name="city" value={city} />}
        <button
          type="submit"
          className={cn(
            'shrink-0 rounded-full bg-brand font-semibold text-on-brand transition-[background-color,transform] duration-300 ease-(--ease-out) hover:bg-brand-hover active:scale-[0.96] active:duration-100',
            big ? 'h-12 px-7' : 'h-9 px-4 text-sm',
          )}
        >
          Search
        </button>
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!showList}
        onMouseDown={() => window.clearTimeout(blurTimer.current)}
        data-lenis-prevent
        className="absolute inset-x-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lift"
      >
        {shown.map((o, i) => (
          <li
            key={o.key}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(o.href)}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 aria-selected:bg-sunken"
          >
            {createElement(ICONS[o.kind], { className: 'size-4 shrink-0 text-ink-3', 'aria-hidden': true })}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-ink">{o.label}</span>
              {o.detail && <span className="truncate text-sm text-ink-3">{o.detail}</span>}
            </span>
            <span className="ml-auto shrink-0 text-xs text-ink-3">
              {o.kind === 'business' ? 'Place' : o.kind === 'category' ? 'Category' : 'Service'}
            </span>
          </li>
        ))}
      </ul>
    </form>
  );
}

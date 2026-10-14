'use client';

import { ArrowRight, Search } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { CategoryIcon } from '../icons';
import { searchKey } from '../groups';

export interface FinderGroup {
  slug: string;
  name: string;
  kinds: { slug: string; name: string }[];
}

/**
 * "Find a kind of place": type part of a name and the kinds that match appear at once, each
 * with its group, so nobody has to read 116 names to find theirs. Nothing found: a way on to
 * searching every place instead.
 */
export function CategoryFinder({ groups }: { groups: FinderGroup[] }) {
  const id = useId();
  const [text, setText] = useState('');
  const query = searchKey(useDeferredValue(text));
  const all = useMemo(
    () =>
      groups.flatMap((g) =>
        g.kinds.map((k) => ({ ...k, group: g.name, key: `${searchKey(k.name)} ${searchKey(g.name)}` })),
      ),
    [groups],
  );
  const matches =
    query.length === 0 ? [] : all.filter((k) => query.split(' ').every((w) => k.key.includes(w)));

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <label htmlFor={id} className="text-base font-semibold text-ink">
        Find a kind of place
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3"
        />
        <input
          id={id}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Try dental, padel or passport"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={60}
          aria-describedby={`${id}-count`}
          className="h-13 w-full rounded-full bg-surface pr-5 pl-12 text-base text-ink shadow-soft ring-1 ring-line placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-control focus-visible:outline-none"
        />
      </div>
      <p id={`${id}-count`} aria-live="polite" className="min-h-5 text-sm text-ink-2">
        {query.length === 0
          ? ''
          : matches.length === 0
            ? `No kind of place called “${text.trim()}” yet.`
            : `${matches.length} ${matches.length === 1 ? 'kind matches' : 'kinds match'}.`}
      </p>
      {matches.length > 0 && (
        <ul className="grid gap-1 rounded-2xl bg-surface p-2 shadow-soft ring-1 ring-line sm:grid-cols-2">
          {matches.slice(0, 24).map((k) => (
            <li key={k.slug}>
              <Link
                href={`/c/${k.slug}` as Route}
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 hover:bg-sunken"
              >
                <CategoryIcon slug={k.slug} className="size-5 shrink-0 text-brand-ink" />
                <span className="flex flex-col leading-tight">
                  <span className="font-medium text-ink">{k.name}</span>
                  <span className="text-sm text-ink-2">{k.group}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.length > 0 && matches.length === 0 && (
        <Link
          href={`/explore?q=${encodeURIComponent(text.trim())}` as Route}
          className="inline-flex items-center gap-1.5 self-start font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          Search every place for “{text.trim()}”
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      )}
    </div>
  );
}

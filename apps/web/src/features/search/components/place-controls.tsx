'use client';

import { LocateFixed } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { filtersQuery, SORTS, withFilters, type Filters, type Sort } from '../params';
import type { City, SearchItem } from '../types';
import { BusinessGrid } from './business-card';

const SORT_LABELS: Record<Sort, string> = {
  relevance: 'Best match',
  rating: 'Top rated',
  newest: 'Newest on BUKU',
};

const selectStyles =
  'h-11 rounded-md border border-control bg-surface px-3 text-[0.95rem] text-ink hover:border-ink-3 focus-visible:border-focus';

/** City and order: changing either runs the search again (it's all in the address). */
export function PlaceControls({ base, filters, cities }: { base: string; filters: Filters; cities: City[] }) {
  const router = useRouter();
  const id = useId();
  const go = (change: Partial<Filters>) =>
    router.push(`${base}${filtersQuery(withFilters(filters, change))}` as Route);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-city`} className="text-sm font-medium text-ink-2">
          City
        </label>
        <select
          id={`${id}-city`}
          value={filters.city}
          onChange={(e) => go({ city: e.target.value })}
          className={selectStyles}
        >
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={`${c.city}-${c.country}`} value={c.city}>
              {c.city} ({c.businesses})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-sort`} className="text-sm font-medium text-ink-2">
          Order
        </label>
        <select
          id={`${id}-sort`}
          value={filters.sort}
          onChange={(e) => go({ sort: e.target.value as Sort })}
          className={selectStyles}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

type NearState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'done'; items: SearchItem[] }
  | { kind: 'error'; message: string };

/**
 * Places near you, nearest first. The browser asks before sharing your
 * location; it's used for this one search and never put in the address.
 */
export function NearMe({ filters }: { filters: Filters }) {
  const [state, setState] = useState<NearState>({ kind: 'idle' });

  const find = () => {
    if (!('geolocation' in navigator)) {
      setState({ kind: 'error', message: 'This browser can’t share your location. Choose a city instead.' });
      return;
    }
    setState({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api<SearchItem[]>('businesses/nearby', {
          query: {
            lat: pos.coords.latitude.toFixed(3), // about 100 m: enough for "near", no more precise than needed
            lng: pos.coords.longitude.toFixed(3),
            radiusKm: 10,
            q: filters.q || undefined,
            openNow: filters.openNow || undefined,
            hasQueue: filters.hasQueue || undefined,
            verifiedOnly: filters.verifiedOnly || undefined,
            minRating: filters.topRated ? 4 : undefined,
            category: filters.category || undefined,
            limit: 24,
          },
        })
          .then((items) => setState({ kind: 'done', items }))
          .catch((e: unknown) =>
            setState({
              kind: 'error',
              message: e instanceof ApiError ? e.message : 'We couldn’t search near you.',
            }),
          );
      },
      (err) =>
        setState({
          kind: 'error',
          message:
            err.code === err.PERMISSION_DENIED
              ? 'Location is turned off for BUKU. Allow it in your browser’s site settings, or choose a city.'
              : 'We couldn’t find where you are. Please try again, or choose a city.',
        }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 120_000 },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={find} disabled={state.kind === 'locating'}>
          {state.kind === 'locating' ? <Spinner className="size-4" /> : <LocateFixed aria-hidden />}
          {state.kind === 'done' ? 'Search near me again' : 'Near me'}
        </Button>
      </div>
      {state.kind === 'error' && <Alert tone="wait" title={state.message} />}
      {state.kind === 'done' && (
        <section aria-labelledby="near-me" className="flex flex-col gap-4">
          <h2 id="near-me" className="font-display text-2xl font-semibold" aria-live="polite">
            {state.items.length === 0
              ? 'Nothing within 10 km matches'
              : `${state.items.length} ${state.items.length === 1 ? 'place' : 'places'} within 10 km`}
          </h2>
          {state.items.length > 0 && <BusinessGrid items={state.items} label="Places near you" />}
        </section>
      )}
    </div>
  );
}

'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BusinessCard } from '@/features/search/components/business-card';
import type { SearchItem } from '@/features/search/types';

export interface Shelf {
  id: string;
  label: string;
  /** The link to the whole list: "All places open now in Lahore". */
  moreLabel: string;
  items: SearchItem[];
  more: Route;
}

/**
 * Real places in the chosen city, one list at a time (open now, popular,
 * top rated) rather than the same few places repeated in three rows. On
 * phones the list is a row you swipe; on wider screens, a grid. Lists with
 * nothing true to show aren't offered.
 */
export function PlacesRail({ shelves }: { shelves: Shelf[] }) {
  const shown = shelves.filter((s) => s.items.length > 0);
  if (shown.length === 0) return null;
  return (
    <Tabs defaultValue={shown[0]!.id} className="flex flex-col gap-8">
      {shown.length > 1 && (
        <TabsList aria-label="Which places" className="self-start">
          {shown.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      )}
      {shown.map((s) => (
        <TabsContent key={s.id} value={s.id} className="mt-0 flex flex-col gap-8">
          <ul
            aria-label={s.label}
            data-lenis-prevent-wheel
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10 sm:overflow-visible sm:px-0 lg:grid-cols-3"
          >
            {s.items.map((item) => (
              <li key={item.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
                <BusinessCard item={item} />
              </li>
            ))}
          </ul>
          <Link
            href={s.more}
            className="self-start font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            {s.moreLabel}
          </Link>
        </TabsContent>
      ))}
    </Tabs>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { HeldDot } from '@/components/brand/held-dot';
import { fetchMe, ME_KEY } from '@/features/auth/api';

const noChange = () => () => undefined;

/** The time of day on this device: morning from 5, afternoon from 12, evening from 17. */
function partOfDay(hour: number) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * "Good evening, Ayesha", by the visitor's own clock (the server doesn't know it, so it starts as
 * "Welcome back" and settles once the page is in the browser), with the logo's held dot.
 */
export function Greeting() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const hour = useSyncExternalStore(
    noChange,
    () => new Date().getHours(),
    () => null,
  );
  const first = me.data?.name.split(' ')[0];
  const hello = hour === null ? 'Welcome back' : partOfDay(hour);
  return (
    <h1 className="text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.04em] text-balance sm:text-[3.4rem]">
      {first ? `${hello}, ${first}` : hello}
      <HeldDot />
    </h1>
  );
}

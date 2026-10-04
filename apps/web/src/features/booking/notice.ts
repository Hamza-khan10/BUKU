'use client';

import { useSyncExternalStore } from 'react';

/** The current minute (ms), refreshed while the page is open; null while rendering on the server. */
const subscribeClock = (onChange: () => void) => {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
};

export function useMinute(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => null,
  );
}

/**
 * Is this start time inside the business's notice period (cancelling it
 * would count as late, and it couldn't be moved)? Said before booking or
 * moving to it, not after.
 */
export function useInsideNotice(startAt: string | null | undefined, noticeHours: number): boolean {
  const now = useMinute();
  if (!startAt || now === null || noticeHours <= 0) return false;
  return Date.parse(startAt) - now < noticeHours * 3_600_000;
}

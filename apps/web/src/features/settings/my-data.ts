/** Small pieces of "your data": the export's file name, and when a deleted account is gone. Pure, tested. */

/**
 * How long a deleted account can still be restored (auth-service's
 * ACCOUNT_DELETION_GRACE_DAYS default; a test keeps them the same).
 */
export const DELETION_GRACE_DAYS = 30;

/** "buku-data-export-2026-10-05.json" */
export const exportFileName = (now: Date) => `buku-data-export-${now.toISOString().slice(0, 10)}.json`;

/** The confirmation people type; the API takes exactly this word. */
export const CONFIRM_WORD = 'DELETE';

export const confirmed = (typed: string) => typed.trim().toUpperCase() === CONFIRM_WORD;

/** Where to go once deleted: the goodbye page, with the last day it can be restored. */
export const goodbyeHref = (purgeAfter: string) => `/goodbye?until=${purgeAfter.slice(0, 10)}`;

/** The `until` date from the goodbye page's address, only if it's a real calendar date. */
export function untilFrom(value: string | string[] | undefined): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** "5 November 2026" */
export const longDate = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);

/**
 * The walk-in queue as the front desk sees it (3.5c), and the rules for what can be done with it
 * now — the same rules queue-service enforces, so the board only offers steps that will work.
 */

export type SessionStatus = 'open' | 'paused' | 'closed';
export type EntryStatus = 'waiting' | 'called' | 'serving';

export interface BoardEntry {
  /** The ticket's row ID (decimal). */
  id: string;
  /** "A-023": what is called out, and the only thing the waiting-room screen shows. */
  ticket: string;
  status: EntryStatus;
  /** The customer's name, or the walk-in's (optional) — never contact details. */
  name: string | null;
  reliability: { label: string; showsUpPercent: number | null } | null;
  walkIn: boolean;
  priority: boolean;
  joinedRemotely: boolean;
  joinedAt: string;
  calledAt: string | null;
  /** Called: from this moment they can be marked as not having come. */
  noShowFrom: string | null;
  servedAt: string | null;
}

export interface BoardSession {
  id: string;
  date: string;
  status: SessionStatus;
  ticketPrefix: string;
  lastCalled: string | null;
  totalServed: number;
  avgServiceMinutes: number;
  gracePeriodSeconds: number;
  openedAt: string | null;
  closedAt: string | null;
}

export interface QueueBoard {
  /** Today's queue, or null before it was first opened today. */
  session: BoardSession | null;
  staffOnShift: number;
  /** In the order they'll be called (priority lane first). */
  waiting: BoardEntry[];
  called: BoardEntry[];
  serving: BoardEntry[];
}

export type SessionAction = 'open' | 'pause' | 'resume' | 'close';
export type EntryAction = 'call' | 'serve' | 'complete' | 'no_show';

/** What can be done with today's queue as a whole. */
export function sessionActions(status: SessionStatus | null): SessionAction[] {
  if (status === 'open') return ['pause', 'close'];
  if (status === 'paused') return ['resume', 'close'];
  return ['open'];
}

/** Calling, serving and adding walk-ins work while the queue is open or paused (pausing stops joining only). */
export const canWork = (status: SessionStatus | null): boolean => status === 'open' || status === 'paused';

/** The steps one ticket allows now. A called ticket can be marked as not come only after the grace period. */
export function entryActions(entry: BoardEntry, now: number): EntryAction[] {
  if (entry.status === 'waiting') return ['call', 'serve'];
  if (entry.status === 'serving') return ['complete'];
  return noShowAllowed(entry, now) ? ['serve', 'no_show'] : ['serve'];
}

export const noShowAllowed = (entry: BoardEntry, now: number): boolean =>
  entry.status === 'called' && (entry.noShowFrom === null || Date.parse(entry.noShowFrom) <= now);

/** Whole minutes since a moment (never negative), for "waiting 12 min". */
export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

/** "just now", "1 min", "12 min", "1 h 5 min" */
export function waited(iso: string, now: number): string {
  const m = minutesSince(iso, now);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** How the queue stands, in words, for the bar at the top of the board. */
export function sessionLabel(session: BoardSession | null): string {
  if (!session) return 'Not opened today';
  if (session.status === 'open') return 'Open';
  if (session.status === 'paused') return 'Paused: not taking new people';
  return 'Closed for today';
}

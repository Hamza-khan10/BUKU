import type { QueueState } from '@/features/business/types';
import type { QueueTicket } from './types';

/**
 * Where my ticket stands, from the queue's public live state (ticket numbers
 * only, never names): the way the API says to read it. Pure, and tested.
 *
 *  • in `called` → it's my turn; in `serving` → being served;
 *  • in `line` → `ahead` = its index, wait ≈ ceil(ahead / staff) × average service time;
 *  • in none of them → something changed (served, left, missed): ask the API.
 */
export type LivePlace =
  | { phase: 'waiting'; ahead: number; minutes: number | null }
  | { phase: 'called' }
  | { phase: 'serving' }
  | { phase: 'gone' };

export function livePlace(state: QueueState, ticket: string): LivePlace {
  if (state.status === 'closed') return { phase: 'gone' };
  if (state.called.includes(ticket)) return { phase: 'called' };
  if (state.serving.includes(ticket)) return { phase: 'serving' };
  const ahead = state.line.indexOf(ticket);
  if (ahead < 0) return { phase: 'gone' };
  const staff = Math.max(1, state.staffOnShift);
  const minutes =
    state.avgServiceSeconds > 0
      ? Math.round((Math.ceil(ahead / staff) * state.avgServiceSeconds) / 60)
      : null;
  return { phase: 'waiting', ahead, minutes };
}

/** Does the live state disagree with the ticket we hold (time to ask the API again)? */
export function changedSince(ticket: QueueTicket, place: LivePlace): boolean {
  if (place.phase === 'gone')
    return ticket.status === 'waiting' || ticket.status === 'called' || ticket.status === 'serving';
  return place.phase !== ticket.status;
}

/** "12 min", "1 h 5 min" — a wait in words. */
export function waitLabel(minutes: number): string {
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

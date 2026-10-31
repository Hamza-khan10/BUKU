import { api } from '@/lib/api/client';
import type { BoardEntry, EntryAction, QueueBoard, SessionAction } from './queue';

/** A business's walk-in queue through our own server (3.5c): the board and each step at the desk. */

export const queueKey = (id: string) => ['business', id, 'queue'] as const;

const base = (id: string) => `businesses/${id}/queue`;

export const fetchBoard = (id: string) => api<QueueBoard>(base(id));

export const changeSession = (id: string, action: SessionAction) =>
  api<unknown>(`${base(id)}/${action}`, { method: 'POST' });

/** Calls whoever is first in line (the priority lane first). */
export const callNext = (id: string) => api<BoardEntry>(`${base(id)}/call-next`, { method: 'POST' });

const ENTRY_PATH: Record<EntryAction, string> = {
  call: 'call',
  serve: 'serve',
  complete: 'complete',
  no_show: 'no-show',
};
export const entryStep = (id: string, entryId: string, action: EntryAction) =>
  api<BoardEntry>(`${base(id)}/entries/${entryId}/${ENTRY_PATH[action]}`, { method: 'POST' });

export const setPriority = (id: string, entryId: string, priority: boolean) =>
  api<BoardEntry>(`${base(id)}/entries/${entryId}/priority`, { method: 'PUT', body: { priority } });

/** Someone at the counter without a phone: a ticket of their own, a name to call out if they give one. */
export const addWalkIn = (id: string, walkIn: { name?: string; priority?: boolean }) =>
  api<BoardEntry>(`${base(id)}/walk-ins`, { method: 'POST', body: walkIn });

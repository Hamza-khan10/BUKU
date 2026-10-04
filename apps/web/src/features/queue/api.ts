import { api } from '@/lib/api/client';
import type { QueueTicket } from './types';

export const TICKET_KEY = (id: string) => ['queue-ticket', id] as const;
export const MY_TICKET_KEY = ['queue-ticket', 'mine'] as const;

/** Join a business's queue from here; the position is only used to check the distance. */
export const joinQueue = (businessId: string, at: { lat: number; lng: number }) =>
  api<QueueTicket>('queue/join', { method: 'POST', body: { businessId, lat: at.lat, lng: at.lng } });

export const fetchTicket = (id: string) => api<QueueTicket>(`queue/tickets/${id}`);

/** My live ticket, wherever it is (one at a time), or null. */
export const fetchMyTicket = () => api<QueueTicket | null>('queue/my-ticket');

export const leaveQueue = (id: string) => api<QueueTicket>(`queue/tickets/${id}/leave`, { method: 'POST' });

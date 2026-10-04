import { describe, expect, it } from 'vitest';
import type { QueueState } from '../src/features/business/types';
import { changedSince, livePlace, waitLabel } from '../src/features/queue/position';
import type { QueueTicket } from '../src/features/queue/types';

const open = (over: Partial<Exclude<QueueState, { status: 'closed' }>> = {}): QueueState => ({
  businessId: 'b1',
  status: 'open',
  remoteJoinRadiusMeters: 5000,
  waiting: 3,
  line: ['A-004', 'A-005', 'A-007'],
  called: ['A-003'],
  serving: ['A-002'],
  estimatedWaitMinutes: 15,
  avgServiceSeconds: 300,
  staffOnShift: 1,
  ...over,
});

const ticket = (status: QueueTicket['status']): QueueTicket => ({
  id: 't1',
  ticket: 'A-005',
  qr: 'A-005',
  status,
  business: { id: 'b1', name: 'Studio', slug: 'studio' },
  ahead: 1,
  estimatedWaitMinutes: 5,
  priority: false,
  joinedAt: '2026-10-05T10:00:00Z',
  calledAt: null,
  comeBy: null,
  servedAt: null,
});

describe('my place in the live line (ticket numbers only)', () => {
  it('counts the tickets before mine, and shares the wait among the staff on shift', () => {
    expect(livePlace(open(), 'A-007')).toEqual({ phase: 'waiting', ahead: 2, minutes: 10 });
    expect(livePlace(open({ staffOnShift: 2 }), 'A-007')).toEqual({ phase: 'waiting', ahead: 2, minutes: 5 });
    expect(livePlace(open(), 'A-004')).toEqual({ phase: 'waiting', ahead: 0, minutes: 0 });
    // Nobody clocked in still means at least one person serving.
    expect(livePlace(open({ staffOnShift: 0 }), 'A-005')).toEqual({ phase: 'waiting', ahead: 1, minutes: 5 });
    expect(livePlace(open({ avgServiceSeconds: 0 }), 'A-005')).toEqual({
      phase: 'waiting',
      ahead: 1,
      minutes: null,
    });
  });

  it('knows when it’s my turn, when I’m being served, and when I’m not in the line any more', () => {
    expect(livePlace(open(), 'A-003')).toEqual({ phase: 'called' });
    expect(livePlace(open(), 'A-002')).toEqual({ phase: 'serving' });
    expect(livePlace(open(), 'A-001')).toEqual({ phase: 'gone' });
    expect(livePlace({ businessId: 'b1', status: 'closed', remoteJoinRadiusMeters: 5000 }, 'A-005')).toEqual({
      phase: 'gone',
    });
  });

  it('asks the API again only when the live line disagrees with the ticket', () => {
    expect(changedSince(ticket('waiting'), { phase: 'waiting', ahead: 0, minutes: 0 })).toBe(false);
    expect(changedSince(ticket('waiting'), { phase: 'called' })).toBe(true);
    expect(changedSince(ticket('called'), { phase: 'serving' })).toBe(true);
    expect(changedSince(ticket('serving'), { phase: 'gone' })).toBe(true);
    expect(changedSince(ticket('completed'), { phase: 'gone' })).toBe(false);
  });
});

describe('waits in words', () => {
  it('reads naturally', () => {
    expect(waitLabel(0)).toBe('under a minute');
    expect(waitLabel(12)).toBe('12 min');
    expect(waitLabel(60)).toBe('1 h');
    expect(waitLabel(65)).toBe('1 h 5 min');
  });
});

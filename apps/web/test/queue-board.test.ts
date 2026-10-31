import { describe, expect, it } from 'vitest';
import {
  canWork,
  entryActions,
  minutesSince,
  noShowAllowed,
  sessionActions,
  sessionLabel,
  waited,
  type BoardEntry,
  type BoardSession,
} from '../src/features/manage/queue';

/** The front desk's queue board (3.5c): it offers only the steps queue-service allows now. */

const NOW = Date.parse('2026-10-31T10:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function entry(over: Partial<BoardEntry> = {}): BoardEntry {
  return {
    id: '1',
    ticket: 'A-001',
    status: 'waiting',
    name: 'Sara',
    reliability: null,
    walkIn: false,
    priority: false,
    joinedRemotely: true,
    joinedAt: minutesAgo(12),
    calledAt: null,
    noShowFrom: null,
    servedAt: null,
    ...over,
  };
}

const session = (status: BoardSession['status']): BoardSession => ({
  id: '9',
  date: '2026-10-31',
  status,
  ticketPrefix: 'A',
  lastCalled: null,
  totalServed: 0,
  avgServiceMinutes: 10,
  gracePeriodSeconds: 300,
  openedAt: minutesAgo(60),
  closedAt: null,
});

describe('the day’s queue', () => {
  it('opens when there is none or it closed; pauses or closes when open; resumes or closes when paused', () => {
    expect(sessionActions(null)).toEqual(['open']);
    expect(sessionActions('closed')).toEqual(['open']);
    expect(sessionActions('open')).toEqual(['pause', 'close']);
    expect(sessionActions('paused')).toEqual(['resume', 'close']);
  });

  it('calling, serving and walk-ins work while open or paused (pausing stops joining only)', () => {
    expect(canWork('open')).toBe(true);
    expect(canWork('paused')).toBe(true);
    expect(canWork('closed')).toBe(false);
    expect(canWork(null)).toBe(false);
  });

  it('says where it stands in words', () => {
    expect(sessionLabel(null)).toBe('Not opened today');
    expect(sessionLabel(session('open'))).toBe('Open');
    expect(sessionLabel(session('paused'))).toBe('Paused: not taking new people');
    expect(sessionLabel(session('closed'))).toBe('Closed for today');
  });
});

describe('a ticket’s steps', () => {
  it('waiting: call, or serve straight away', () => {
    expect(entryActions(entry(), NOW)).toEqual(['call', 'serve']);
  });

  it('being served: done', () => {
    expect(entryActions(entry({ status: 'serving', servedAt: minutesAgo(3) }), NOW)).toEqual(['complete']);
  });

  it('called: they’re here; “didn’t come” only once the grace period has passed', () => {
    const early = entry({ status: 'called', calledAt: minutesAgo(2), noShowFrom: minutesAgo(-3) });
    expect(noShowAllowed(early, NOW)).toBe(false);
    expect(entryActions(early, NOW)).toEqual(['serve']);
    const late = entry({ status: 'called', calledAt: minutesAgo(6), noShowFrom: minutesAgo(1) });
    expect(noShowAllowed(late, NOW)).toBe(true);
    expect(entryActions(late, NOW)).toEqual(['serve', 'no_show']);
    // At the very moment it's allowed, it's allowed (the API checks "not before").
    expect(noShowAllowed(entry({ status: 'called', noShowFrom: new Date(NOW).toISOString() }), NOW)).toBe(
      true,
    );
  });

  it('only a called ticket can be marked as not having come', () => {
    expect(noShowAllowed(entry({ noShowFrom: minutesAgo(10) }), NOW)).toBe(false);
  });
});

describe('how long', () => {
  it('counts whole minutes, never below zero', () => {
    expect(minutesSince(minutesAgo(12.9), NOW)).toBe(12);
    expect(minutesSince(minutesAgo(-5), NOW)).toBe(0);
  });

  it('reads naturally', () => {
    expect(waited(minutesAgo(0.5), NOW)).toBe('just now');
    expect(waited(minutesAgo(1), NOW)).toBe('1 min');
    expect(waited(minutesAgo(59), NOW)).toBe('59 min');
    expect(waited(minutesAgo(60), NOW)).toBe('1 h');
    expect(waited(minutesAgo(65), NOW)).toBe('1 h 5 min');
  });
});

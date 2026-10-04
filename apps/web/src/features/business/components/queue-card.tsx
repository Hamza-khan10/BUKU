'use client';

import { Users } from 'lucide-react';
import { LiveDot } from '@/components/ui/live-dot';
import { JoinQueue } from '@/features/queue/components/join-queue';
import { useLiveQueue } from '@/features/queue/use-live-queue';
import { distance } from '@/lib/format';
import type { QueueState } from '../types';
import { SideCard } from './side-cards';

/**
 * The business's walk-in queue, live: open or not, how many are waiting,
 * which tickets are being served, the wait for someone joining now — and the
 * way to join from the phone. It follows the queue over a stream (ticket
 * numbers only) and reconnects by itself; while it can't, it says so instead
 * of showing stale numbers as live.
 */
export function QueueCard({
  slug,
  businessId,
  initial,
  signedIn,
}: {
  slug: string;
  businessId: string;
  initial: QueueState;
  signedIn: boolean;
}) {
  const { state: current, live } = useLiveQueue(slug, initial);
  const state = current ?? initial;

  if (state.status === 'closed') {
    return (
      <SideCard title="Walk-in queue">
        <p className="text-sm text-ink-2">The queue isn’t open right now.</p>
      </SideCard>
    );
  }

  const paused = state.status === 'paused';
  return (
    <SideCard title="Walk-in queue" className="border-wait/40">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-wait-ink">
          {live && !paused && <LiveDot tone="wait" />}
          {paused ? 'Paused for now' : 'Open'}
        </span>
        <span className="text-xs text-ink-3" aria-live="polite">
          {live ? 'Updates live' : 'Reconnecting…'}
        </span>
      </div>
      <p className="mt-3 flex items-baseline gap-2" aria-live="polite">
        <Users className="size-5 self-center text-ink-3" aria-hidden />
        <span className="font-display text-4xl font-bold tabular">{state.waiting}</span>
        <span className="text-ink-2">{state.waiting === 1 ? 'person waiting' : 'people waiting'}</span>
      </p>
      {state.estimatedWaitMinutes !== null && state.waiting > 0 && (
        <p className="mt-1 text-sm text-ink-2">
          About {state.estimatedWaitMinutes} min for someone joining now.
        </p>
      )}
      {state.serving.length > 0 && (
        <p className="mt-3 text-sm text-ink-2">
          Now serving: <span className="font-mono font-semibold text-ink">{state.serving.join(', ')}</span>
        </p>
      )}
      {paused && <p className="mt-3 text-sm text-ink-2">No new sign-ups from phones while it’s paused.</p>}
      <JoinQueue
        business={{ id: businessId, slug }}
        signedIn={signedIn}
        paused={paused}
        radiusMeters={state.remoteJoinRadiusMeters}
      />
      {!signedIn && (
        <p className="mt-3 text-xs text-ink-3">
          You can join from within {distance(state.remoteJoinRadiusMeters / 1000)} of the business.
        </p>
      )}
    </SideCard>
  );
}

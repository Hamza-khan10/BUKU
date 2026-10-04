'use client';

import { useEffect, useState } from 'react';
import type { QueueState } from '@/features/business/types';

/**
 * A business's queue, live: its public state (ticket numbers only, never
 * names) over a stream that reconnects by itself and starts each connection
 * with the full state, so nothing is missed. `live` is false while it can't —
 * the page then says so instead of showing old numbers as current.
 */
export function useLiveQueue(slug: string, initial: QueueState | null = null) {
  const [state, setState] = useState<QueueState | null>(initial);
  const [live, setLive] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const source = new EventSource(`/api/live/queue/${slug}`);
    source.addEventListener('state', (e: MessageEvent<string>) => {
      try {
        setState(JSON.parse(e.data) as QueueState);
        setLive(true);
      } catch {
        // A malformed message: keep what we have.
      }
    });
    // The queue is no longer public (the business was suspended): stop listening.
    source.addEventListener('unavailable', () => {
      setLive(false);
      setGone(true);
      source.close();
    });
    source.onerror = () => setLive(false);
    return () => source.close();
  }, [slug]);

  return { state, live, gone };
}

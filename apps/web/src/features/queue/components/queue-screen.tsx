'use client';

import { Maximize } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState, type CSSProperties } from 'react';
import { SplitFlap } from '@/components/motion/split-flap';
import type { QueueState } from '@/features/business/types';
import { cn } from '@/lib/cn';
import { useLiveQueue } from '../use-live-queue';

const TICKET_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
/** How many of the line the screen lists; more are counted, not shown. */
const NEXT_SHOWN = 8;

/**
 * The waiting-room screen (3.5c): who to come to the counter, who is being served, and who's
 * next — ticket numbers only, live. Made to be read from across a room: large, high-contrast,
 * the board's colours in both themes. It keeps the display awake while it's shown (where the
 * browser allows), announces each newly called ticket to screen readers, and says plainly when
 * it can't follow the queue instead of showing old numbers as current.
 */
export function QueueScreen({
  slug,
  name,
  joinUrl,
  initial,
}: {
  slug: string;
  name: string;
  joinUrl: string;
  initial: QueueState | null;
}) {
  const { state, live, gone } = useLiveQueue(slug, initial);
  useWakeLock();
  const clock = useClock();

  const open = state !== null && state.status !== 'closed' && !gone;
  const calling = open ? state.called : [];
  const serving = open ? state.serving : [];
  const line = open ? state.line : [];
  const lead = calling[0] ?? null;

  return (
    <div className="flex min-h-dvh flex-col gap-8 bg-board p-6 text-board-ink sm:p-10 lg:p-14">
      <header className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-lg text-board-ink-2">The queue at</p>
          <h1 className="text-3xl font-semibold tracking-[-0.02em] sm:text-5xl">{name}</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="tabular text-3xl font-semibold text-board-ink-2 sm:text-4xl" suppressHydrationWarning>
            {clock}
          </p>
          <FullScreenButton />
        </div>
      </header>

      {/* Read out each newly called ticket; the board itself is for the eyes. */}
      <p aria-live="assertive" className="sr-only">
        {lead ? `Now calling ${lead}. Please come to the counter.` : ''}
      </p>

      {!open ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-4xl font-semibold sm:text-6xl">
            {gone ? 'The queue isn’t available here.' : 'The queue is closed for today.'}
          </p>
          {!gone && <p className="text-xl text-board-ink-2 sm:text-2xl">Bookings are still open on BUKU.</p>}
        </div>
      ) : (
        <div className="grid flex-1 gap-8 lg:grid-cols-[3fr_2fr]">
          <section aria-label="Please come to the counter" className="flex flex-col gap-6">
            <h2 className="text-2xl font-medium text-board-ink-2 sm:text-3xl">Please come to the counter</h2>
            {lead ? (
              <div className="flex flex-col gap-5">
                <SplitFlap
                  value={lead}
                  charset={TICKET_CHARS}
                  className="text-[5rem] font-semibold sm:text-[8rem] lg:text-[10rem]"
                  style={{ '--flap-ink': 'var(--color-board-go)' } as CSSProperties}
                />
                {calling.length > 1 && (
                  <ul aria-label="Also called" className="flex flex-wrap gap-3">
                    {calling.slice(1).map((t) => (
                      <li
                        key={t}
                        className="tabular rounded-xl bg-board-tile px-5 py-3 font-mono text-4xl font-semibold text-board-go"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-3xl text-board-ink-2 sm:text-4xl">Nobody is being called right now.</p>
            )}
            {serving.length > 0 && (
              <div className="mt-auto flex flex-col gap-3">
                <h2 className="text-xl font-medium text-board-ink-2 sm:text-2xl">Being served</h2>
                <ul className="flex flex-wrap gap-3">
                  {serving.map((t) => (
                    <li
                      key={t}
                      className="tabular rounded-xl bg-board-tile px-5 py-3 font-mono text-3xl font-semibold"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-label="Next" className="flex flex-col gap-6 rounded-2xl bg-board-tile p-6 sm:p-8">
            <h2 className="text-2xl font-medium text-board-ink-2 sm:text-3xl">Next</h2>
            {line.length === 0 ? (
              <p className="text-2xl text-board-ink-2">Nobody is waiting.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {line.slice(0, NEXT_SHOWN).map((t, i) => (
                  <li
                    key={t}
                    className={cn(
                      'tabular flex items-baseline gap-4 font-mono font-semibold',
                      i === 0 ? 'text-5xl text-board-spark' : 'text-4xl',
                    )}
                  >
                    {t}
                  </li>
                ))}
              </ol>
            )}
            {line.length > NEXT_SHOWN && (
              <p className="text-xl text-board-ink-2">and {line.length - NEXT_SHOWN} more</p>
            )}
          </section>
        </div>
      )}

      <footer className="flex flex-wrap items-end justify-between gap-6 border-t border-white/10 pt-6">
        <div className="flex flex-col gap-2 text-xl sm:text-2xl">
          {open && state.status === 'paused' ? (
            <p className="font-semibold text-board-spark">Not taking new people right now.</p>
          ) : open ? (
            <p>
              {state.waiting} waiting
              {state.estimatedWaitMinutes !== null && (
                <> · about {state.estimatedWaitMinutes} min for a new place</>
              )}
            </p>
          ) : null}
          {!live && open && (
            <p className="text-lg text-board-ink-2">Reconnecting… these numbers may be behind.</p>
          )}
        </div>
        {open && state.status === 'open' && (
          <div className="flex items-center gap-5">
            <p className="max-w-56 text-right text-lg text-board-ink-2">Join the queue from your phone</p>
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG
                value={joinUrl}
                size={132}
                level="M"
                aria-label="QR code: the business’s page on BUKU"
                role="img"
              />
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}

/** Keeps the display from sleeping while the screen is shown, where the browser allows it. */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const ask = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) await lock.release();
      } catch {
        // Not allowed here (battery saver, browser policy): the screen may dim, nothing breaks.
      }
    };
    void ask();
    // The lock is let go when the tab is hidden; take it again when it's back.
    document.addEventListener('visibilitychange', ask);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', ask);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

/** The time here, "14:05", moving every few seconds. */
function useClock(): string {
  const format = () =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const [time, setTime] = useState(format);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(format()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  return time;
}

/** Full screen at a press (a TV's browser often starts windowed); hidden once it is. */
function FullScreenButton() {
  const [full, setFull] = useState(true);
  useEffect(() => {
    const update = () => setFull(document.fullscreenElement !== null || !document.fullscreenEnabled);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  if (full) return null;
  return (
    <button
      type="button"
      onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}
      className="grid size-12 place-items-center rounded-full text-board-ink-2 hover:bg-board-tile hover:text-board-ink"
      aria-label="Full screen"
    >
      <Maximize aria-hidden className="size-6" />
    </button>
  );
}

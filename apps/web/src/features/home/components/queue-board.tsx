'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { MARK } from '@/components/brand/mark';
import { BoardLive, BoardPause, BoardSurface, useBoardStory } from '@/components/motion/board';
import { SplitFlap } from '@/components/motion/split-flap';
import { cn } from '@/lib/cn';

/**
 * The home page's one bold moment (WEB_PLAN §2, "the board"): a waiting-room board telling a
 * queue's story as BUKU tells it, from three ahead of you to "It's your turn", then again. An
 * illustration of the product, captioned as one; the numbers are not anyone's real queue.
 *
 * Two things make it BUKU's own (3.7i, D-143). Its status light is the logo: the Saffron dot waits
 * above the cup and drops into it on "your turn". And the visitor can take part: "Take a number"
 * gives them the next ticket, at most three ahead, the line moves on every 1.6 s, and their turn
 * comes with the dot and the way in (early access before launch). Pressing again takes another.
 */

const STORY_YOURS = 10;
const STORY = [
  { serving: 7, line: '3 ahead of you. About 12 minutes.' },
  { serving: 8, line: '2 ahead of you. About 8 minutes.' },
  { serving: 9, line: 'You’re next. Head over now.' },
  { serving: 10, line: 'It’s your turn.' },
] as const;
const STEP_MS = 3400;
/** A visitor's own number moves faster than the story: a demo, not a wait. */
const MINE_STEP_MS = 1600;

const two = (n: number) => String(n % 100).padStart(2, '0');

/** What to say with `ahead` people before you. */
function lineFor(ahead: number) {
  if (ahead >= 3) return `${ahead} ahead of you. We’ll tell you when to come.`;
  if (ahead === 2) return '2 ahead of you. About 8 minutes.';
  if (ahead === 1) return 'You’re next. Head over now.';
  return 'It’s your turn.';
}

/**
 * The logo as a status light: the cup, and the Saffron dot above it while you wait; on your turn
 * the dot drops in and settles (a landing earns its small bounce). Still under reduced motion.
 */
function TurnCup({ held }: { held: boolean }) {
  return (
    <svg viewBox="0 -24 60 84" aria-hidden className="h-[2.1rem] w-[1.5rem] shrink-0">
      <path
        d={MARK.cup}
        fill="none"
        stroke="var(--color-board-ink)"
        strokeWidth={MARK.cupWidth}
        strokeLinecap="round"
      />
      <circle
        {...MARK.dot}
        fill="var(--color-board-spark)"
        className="transition-transform duration-500 ease-[cubic-bezier(0.34,1.5,0.64,1)]"
        style={{ transform: held ? 'none' : 'translateY(-44px)' }}
      />
    </svg>
  );
}

export function QueueBoard({
  className,
  cta,
}: {
  className?: string;
  /** Where "your turn" leads: early access before launch, then finding a place. */
  cta: { href: Route; label: string };
}) {
  const story = useBoardStory(STORY.length, STEP_MS);
  // The visitor's own number and where the line is, once they've taken one.
  const [mine, setMine] = useState<{ yours: number; serving: number } | null>(null);

  const step = STORY[story.step]!;
  const servingNow = mine ? mine.serving : step.serving;
  const yoursNow = mine ? mine.yours : STORY_YOURS;
  const ahead = yoursNow - servingNow;
  const turn = ahead === 0;
  const line = mine ? lineFor(ahead) : step.line;
  // Before the story starts the board reads 00, then flips to the first step (the page's one entrance).
  const shown = story.started || mine !== null;
  const serving = shown ? two(servingNow) : '00';
  const yours = shown ? two(yoursNow) : '00';

  // The line moves on, one person at a time, until it's the visitor's turn.
  useEffect(() => {
    if (!mine || mine.serving >= mine.yours) return;
    const t = window.setTimeout(
      () => setMine((m) => (m ? { ...m, serving: m.serving + 1 } : m)),
      MINE_STEP_MS,
    );
    return () => window.clearTimeout(t);
  }, [mine]);

  // The next ticket off the roll (always a new number, so both counters flip: you can see you've
  // got one), at most three ahead of whoever is being served. Pressing again takes another.
  const take = () => {
    const next = yoursNow + 1;
    setMine({ yours: next, serving: Math.max(servingNow, next - 3) });
  };

  return (
    <figure className={cn('flex flex-col items-center gap-4', className)}>
      <BoardSurface boardRef={story.ref} reduce={story.reduce}>
        <div className="flex items-center justify-between text-sm text-board-ink-2">
          <span>Walk-in queue</span>
          <BoardLive still={story.still && !mine} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-5 sm:mt-6 sm:gap-6">
          <div className="flex flex-col gap-3">
            <span className="text-sm text-board-ink-2">Now serving</span>
            <SplitFlap
              value={serving}
              label={String(Number(serving))}
              className="text-[3.5rem] font-semibold sm:text-[5rem]"
            />
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-sm text-board-ink-2">Your number</span>
            <SplitFlap
              value={yours}
              label={String(Number(yours))}
              className="text-[3.5rem] font-semibold sm:text-[5rem]"
              style={{ '--flap-ink': 'var(--color-board-spark)' } as CSSProperties}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4 sm:mt-7 sm:pt-5">
          <TurnCup held={turn} />
          <p
            key={mine ? `mine-${ahead}` : story.step}
            // The visitor's own countdown is read out as it moves; the looping story isn't.
            aria-live={mine ? 'polite' : undefined}
            className={cn(
              // Two lines kept on a phone, where some lines wrap: the board never changes height
              // while the line moves on (nothing below it jumps).
              'min-h-[2lh] flex-1 text-lg font-medium tracking-[-0.01em] animate-line sm:min-h-0',
              turn ? 'text-board-go' : 'text-board-ink',
            )}
          >
            {line}
          </p>
          {!story.reduce && !mine && <BoardPause paused={story.paused} onToggle={story.togglePause} />}
        </div>

        {/* The button stays put (focus never drops); once it's the visitor's turn, the way in
            becomes the main action beside it. */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={take}
            className={cn(
              'inline-flex h-11 items-center rounded-full px-5 text-[0.95rem] font-semibold transition-transform duration-150 ease-(--ease-out) active:scale-[0.96]',
              mine && turn
                ? 'text-board-ink ring-1 ring-white/25 hover:bg-white/10'
                : 'bg-board-go-fill text-board-on-go',
            )}
          >
            {mine ? 'Take another number' : 'Take a number'}
          </button>
          {mine && turn && (
            <Link
              href={cta.href}
              className="inline-flex h-11 animate-line items-center rounded-full bg-board-go-fill px-5 text-[0.95rem] font-semibold text-board-on-go transition-transform duration-150 ease-(--ease-out) active:scale-[0.96]"
            >
              {cta.label}
            </Link>
          )}
        </div>
      </BoardSurface>
      <figcaption className="text-sm text-ink-3">What waiting in a queue looks like on BUKU</figcaption>
    </figure>
  );
}

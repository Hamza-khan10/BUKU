'use client';

import type { CSSProperties } from 'react';
import { BoardLive, BoardPause, BoardSurface, useBoardStory } from '@/components/motion/board';
import { SplitFlap } from '@/components/motion/split-flap';
import { cn } from '@/lib/cn';

/**
 * The home page's one bold moment (WEB_PLAN §2, "the board"): a waiting-room
 * board telling a queue's story as BUKU tells it, from three ahead of you to
 * "It's your turn", then again. An illustration of the product, captioned as
 * one; the numbers are not anyone's real queue.
 */

const YOURS = 10;
const STORY = [
  { serving: 7, line: '3 ahead of you. About 12 minutes.', tone: 'wait' },
  { serving: 8, line: '2 ahead of you. About 8 minutes.', tone: 'wait' },
  { serving: 9, line: 'You’re next. Head over now.', tone: 'wait' },
  { serving: 10, line: 'It’s your turn.', tone: 'go' },
] as const;
const STEP_MS = 3400;

const two = (n: number) => String(n).padStart(2, '0');

export function QueueBoard({ className }: { className?: string }) {
  const story = useBoardStory(STORY.length, STEP_MS);
  const now = STORY[story.step]!;
  // Before the story starts the board reads 00, then flips to the first step (the page's one entrance).
  const serving = story.started ? two(now.serving) : '00';
  const yours = story.started ? two(YOURS) : '00';

  return (
    <figure className={cn('flex flex-col items-center gap-4', className)}>
      <BoardSurface boardRef={story.ref} reduce={story.reduce}>
        <div className="flex items-center justify-between text-sm text-board-ink-2">
          <span>Walk-in queue</span>
          <BoardLive still={story.still} />
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
              label={String(YOURS)}
              className="text-[3.5rem] font-semibold sm:text-[5rem]"
              style={{ '--flap-ink': 'var(--color-board-spark)' } as CSSProperties}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4 sm:mt-7 sm:pt-5">
          <span
            aria-hidden
            className={cn(
              'size-2.5 shrink-0 rounded-full transition-colors duration-500',
              now.tone === 'go' ? 'bg-board-go-fill' : 'bg-board-spark',
            )}
          />
          <p
            key={story.step}
            className={cn(
              'flex-1 text-lg font-medium tracking-[-0.01em] animate-line',
              now.tone === 'go' ? 'text-board-go' : 'text-board-ink',
            )}
          >
            {now.line}
          </p>
          {!story.reduce && <BoardPause paused={story.paused} onToggle={story.togglePause} />}
        </div>
      </BoardSurface>
      <figcaption className="text-sm text-ink-3">What waiting in a queue looks like on BUKU</figcaption>
    </figure>
  );
}

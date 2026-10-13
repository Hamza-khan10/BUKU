'use client';

import { Check } from 'lucide-react';
import { BoardLive, BoardPause, BoardSurface, useBoardStory } from '@/components/motion/board';
import { SplitFlap } from '@/components/motion/split-flap';
import { cn } from '@/lib/cn';

/**
 * The business side of the queue board (WEB_PLAN §2): what the front desk sees through a
 * morning — the next person called, someone joining from home, a booking checking in — told as
 * a short story that loops while the board is on screen, like the home page's. An illustration,
 * captioned as one; not anyone's real queue.
 */

const STORY = [
  { serving: 21, waiting: 4, line: 'Next up: number 22.', called: false },
  { serving: 22, waiting: 3, line: 'Number 22 is on their way.', called: true },
  { serving: 22, waiting: 4, line: 'Number 26 joined from home.', called: false },
  { serving: 23, waiting: 3, line: 'Number 23 is on their way.', called: true },
  { serving: 23, waiting: 3, line: 'A 10:30 booking just checked in.', called: false },
] as const;
const STEP_MS = 3200;

const two = (n: number) => String(n).padStart(2, '0');

export function FrontDeskBoard({ className }: { className?: string }) {
  const story = useBoardStory(STORY.length, STEP_MS);
  const now = STORY[story.step]!;
  const serving = story.started ? two(now.serving) : '00';
  const waiting = story.started ? two(now.waiting) : '00';

  return (
    <figure className={cn('flex flex-col items-center gap-4', className)}>
      <BoardSurface boardRef={story.ref} reduce={story.reduce}>
        <div className="flex items-center justify-between text-sm text-board-ink-2">
          <span>Front desk</span>
          <BoardLive still={story.still} label="Queue open" />
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
            <span className="text-sm text-board-ink-2">Waiting</span>
            <SplitFlap
              value={waiting}
              label={String(Number(waiting))}
              className="text-[3.5rem] font-semibold sm:text-[5rem]"
            />
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4 sm:mt-7 sm:pt-5">
          <p
            key={story.step}
            className="flex-1 font-medium tracking-[-0.01em] text-board-ink animate-line sm:text-lg"
          >
            {now.line}
          </p>
          {/* The one button the front desk needs, pressed as the story calls the next person. */}
          <span
            aria-hidden
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-[background-color,color,transform] duration-300 ease-(--ease-out) sm:h-11 sm:px-5',
              now.called
                ? 'scale-[0.97] bg-board-go-fill/20 text-board-go'
                : 'bg-board-go-fill text-board-on-go',
            )}
          >
            {now.called && <Check className="size-4" strokeWidth={3} />}
            {now.called ? 'Called' : 'Call next'}
          </span>
          {!story.reduce && <BoardPause paused={story.paused} onToggle={story.togglePause} />}
        </div>
      </BoardSurface>
      <figcaption className="text-sm text-ink-3">What the front desk sees on BUKU</figcaption>
    </figure>
  );
}

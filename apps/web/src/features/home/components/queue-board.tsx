'use client';

import { Pause, Play } from 'lucide-react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { SplitFlap } from '@/components/motion/split-flap';
import { useReducedMotion } from '@/components/motion/use-reduced-motion';
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
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  // Moving content that runs longer than five seconds can be paused (WCAG 2.2.2).
  const [paused, setPaused] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const still = reduce || paused;

  // Tell the story only while the board is on screen, the tab is visible, and it isn't paused.
  useEffect(() => {
    if (still || !board.current) return;
    let visible = false;
    let timer: number | undefined;
    const run = () => {
      window.clearInterval(timer);
      if (visible && document.visibilityState === 'visible') {
        timer = window.setInterval(() => setStep((s) => (s + 1) % STORY.length), STEP_MS);
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) setStarted(true);
      run();
    });
    observer.observe(board.current);
    document.addEventListener('visibilitychange', run);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', run);
      window.clearInterval(timer);
    };
  }, [still]);

  // A slight tilt toward the pointer, on a spring (desktop pointers only).
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-5, 5]), { stiffness: 140, damping: 18 });
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [4, -4]), { stiffness: 140, damping: 18 });
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

  // Before the story starts the board reads 00, then flips to the first step (the page's one entrance).
  const now = STORY[step]!;
  const serving = started || reduce ? two(now.serving) : '00';
  const yours = started || reduce ? two(YOURS) : '00';

  return (
    <figure className={cn('flex flex-col items-center gap-4', className)}>
      <div className="w-full [perspective:1200px]" onPointerMove={onMove} onPointerLeave={onLeave}>
        <motion.div
          ref={board}
          style={{ rotateX, rotateY }}
          initial={reduce ? false : { opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ type: 'spring', bounce: 0, duration: 0.9 }}
          className="relative w-full overflow-hidden rounded-2xl bg-night p-6 text-[#edf2ef] shadow-lift ring-1 ring-white/8 sm:p-8 dark:bg-[#141b17] dark:ring-white/10"
        >
          {/* Light catching the top edge of the board. */}
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/15" />

          <div className="flex items-center justify-between text-sm text-[#b9c2bd]">
            <span>Walk-in queue</span>
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className={cn('size-2 rounded-full bg-[#f2b655] text-[#f2b655]', !still && 'animate-live')}
              />
              Live
            </span>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-3">
              <span className="text-sm text-[#b9c2bd]">Now serving</span>
              <SplitFlap
                value={serving}
                label={String(Number(serving))}
                className="text-[4.25rem] font-semibold sm:text-[5rem]"
              />
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-sm text-[#b9c2bd]">Your number</span>
              <SplitFlap
                value={yours}
                label={String(YOURS)}
                className="text-[4.25rem] font-semibold sm:text-[5rem]"
                style={{ '--flap-ink': '#f2b655' } as CSSProperties}
              />
            </div>
          </div>

          <div className="mt-7 flex items-center gap-3 border-t border-white/10 pt-5">
            <span
              aria-hidden
              className={cn(
                'size-2.5 shrink-0 rounded-full transition-colors duration-500',
                now.tone === 'go' ? 'bg-[#3fc495]' : 'bg-[#f2b655]',
              )}
            />
            <p
              key={step}
              className={cn(
                'flex-1 text-lg font-medium tracking-[-0.01em] animate-rise',
                now.tone === 'go' ? 'text-[#5ed3a8]' : 'text-[#edf2ef]',
              )}
            >
              {now.line}
            </p>
            {!reduce && (
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? 'Play the example' : 'Pause the example'}
                aria-pressed={paused}
                className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-[#b9c2bd] transition-colors hover:bg-white/10 hover:text-[#edf2ef] focus-visible:outline-[#5ed3a8]"
              >
                {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              </button>
            )}
          </div>
        </motion.div>
      </div>
      <figcaption className="text-sm text-ink-3">What waiting in a queue looks like on BUKU</figcaption>
    </figure>
  );
}

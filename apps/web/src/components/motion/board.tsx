'use client';

import { Pause, Play } from 'lucide-react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from './use-reduced-motion';

/**
 * What every "board" (the split-flap displays on the home page and the business page) shares,
 * so they move the same way: a short story that loops while the board is on screen and the tab
 * is visible, a pause (anything moving for more than five seconds can be paused, WCAG 2.2.2), a
 * slight tilt toward a mouse on a spring, and the still glow behind it.
 */

/** A story of `length` steps, a step every `stepMs`, only while seen; `started` once first seen. */
export function useBoardStory(length: number, stepMs: number) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const still = reduce || paused;

  useEffect(() => {
    if (still || !ref.current) return;
    let visible = false;
    let timer: number | undefined;
    const run = () => {
      window.clearInterval(timer);
      if (visible && document.visibilityState === 'visible') {
        timer = window.setInterval(() => setStep((s) => (s + 1) % length), stepMs);
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) setStarted(true);
      run();
    });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', run);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', run);
      window.clearInterval(timer);
    };
  }, [still, length, stepMs]);

  return {
    ref,
    step,
    started: started || reduce,
    reduce,
    paused,
    still,
    togglePause: () => setPaused((p) => !p),
  };
}

/** The board itself: Midnight, a tilt toward a mouse on a spring, and one soft entrance. */
export function BoardSurface({
  boardRef,
  reduce,
  className,
  children,
}: {
  boardRef: React.Ref<HTMLDivElement>;
  reduce: boolean;
  className?: string;
  children: ReactNode;
}) {
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
  return (
    <div className="w-full [perspective:1200px]" onPointerMove={onMove} onPointerLeave={onLeave}>
      <motion.div
        ref={boardRef}
        style={{ rotateX, rotateY }}
        initial={reduce ? false : { opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{ type: 'spring', bounce: 0, duration: 0.9 }}
        className={cn(
          'relative w-full overflow-hidden rounded-2xl bg-board p-5 text-board-ink shadow-lift ring-1 ring-white/8 sm:p-8 dark:ring-white/12',
          className,
        )}
      >
        {/* Light catching the top edge of the board. */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/15" />
        {children}
      </motion.div>
    </div>
  );
}

/** Pause or play a board's story (shown only where it moves at all). */
export function BoardPause({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={paused ? 'Play the example' : 'Pause the example'}
      aria-pressed={paused}
      className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-board-ink-2 transition-colors hover:bg-white/10 hover:text-board-ink focus-visible:outline-board-go"
    >
      {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
    </button>
  );
}

/** The "Live" label with its pulse (the pulse stops when the story is still). */
export function BoardLive({ still, label = 'Live' }: { still: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={cn('size-2 rounded-full bg-board-spark text-board-spark', !still && 'animate-live')}
      />
      {label}
    </span>
  );
}

/**
 * The still glow behind a board (emerald light, a touch of saffron): depth without more motion.
 * It stays inside the page's gutters on phones, so nothing scrolls sideways.
 */
export function BoardGlow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative isolate mx-auto w-full max-w-[30rem] lg:mr-0', className)}>
      <div
        aria-hidden
        className="absolute -inset-x-4 -inset-y-16 -z-10 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand)_20%,transparent),transparent)] lg:-inset-x-20 lg:-inset-y-24"
      />
      <div
        aria-hidden
        className="absolute -bottom-12 -left-4 -z-10 size-56 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-spark)_32%,transparent),transparent)] lg:-left-16"
      />
      {children}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { SplitFlap } from '@/components/motion/split-flap';
import { useReducedMotion } from '@/components/motion/use-reduced-motion';
import { cn } from '@/lib/cn';

/**
 * The business side of the queue board (WEB_PLAN §2): what the front desk
 * sees, now serving, how many are waiting, and the one button that calls the
 * next person. When it comes into view the next ticket is called once, so the
 * board shows what that button does. An illustration, captioned as one.
 */
export function FrontDeskBoard({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [called, setCalled] = useState(false);
  const board = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce || !board.current) return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        timer = window.setTimeout(() => setCalled(true), 900);
        observer.disconnect();
      }
    });
    observer.observe(board.current);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [reduce]);

  const serving = called ? '22' : '21';
  const waiting = called ? '03' : '04';

  return (
    <figure className={cn('flex flex-col items-center gap-4', className)}>
      <div
        ref={board}
        className="relative w-full overflow-hidden rounded-2xl bg-night p-6 text-[#edf2ef] shadow-lift ring-1 ring-white/8 sm:p-8 dark:bg-[#141b17] dark:ring-white/10"
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/15" />
        <div className="flex items-center justify-between text-sm text-[#b9c2bd]">
          <span>Front desk</span>
          <span>Walk-in queue open</span>
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
            <span className="text-sm text-[#b9c2bd]">Waiting</span>
            <SplitFlap
              value={waiting}
              label={String(Number(waiting))}
              className="text-[4.25rem] font-semibold sm:text-[5rem]"
            />
          </div>
        </div>
        <div className="mt-7 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
          <p className="text-[#b9c2bd]">{called ? 'Number 22 is on their way.' : 'Next up: number 22.'}</p>
          <span
            aria-hidden
            className={cn(
              'inline-flex h-11 items-center rounded-full px-5 font-semibold transition-[background-color,color,transform] duration-300',
              called ? 'scale-[0.97] bg-[#3fc495]/20 text-[#5ed3a8]' : 'bg-[#3fc495] text-[#06140f]',
            )}
          >
            {called ? 'Called' : 'Call next'}
          </span>
        </div>
      </div>
      <figcaption className="text-sm text-ink-3">What the front desk sees on BUKU</figcaption>
    </figure>
  );
}

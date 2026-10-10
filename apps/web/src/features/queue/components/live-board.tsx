'use client';

import type { CSSProperties } from 'react';
import { SplitFlap } from '@/components/motion/split-flap';
import { cn } from '@/lib/cn';

/**
 * The queue board on your ticket's page (WEB_PLAN §2): how many are ahead of
 * you, flipping as the line moves, and your number. The ticket below says the
 * same in words (and announces changes), so the board is for the eyes only.
 */
export function LiveBoard({ ahead, code, called }: { ahead: number | null; code: string; called: boolean }) {
  const shown = called ? '00' : ahead === null ? '--' : String(Math.min(ahead, 99)).padStart(2, '0');
  return (
    <div
      aria-hidden
      className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-night p-6 text-[#edf2ef] shadow-lift ring-1 ring-white/8 sm:p-8 dark:bg-[#141b17] dark:ring-white/10"
    >
      <span className="absolute inset-x-0 top-0 h-px bg-white/15" />
      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          <span className="text-sm text-[#b9c2bd]">{called ? 'Your turn' : 'Ahead of you'}</span>
          <SplitFlap
            value={shown}
            charset="0123456789"
            className="text-[4rem] font-semibold sm:text-[4.75rem]"
            style={called ? ({ '--flap-ink': '#5ed3a8' } as CSSProperties) : undefined}
          />
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-sm text-[#b9c2bd]">Your number</span>
          <span className="tabular text-[2.5rem] leading-[1.12] font-semibold tracking-[-0.02em] text-[#f2b655] sm:text-[3rem]">
            {code}
          </span>
        </div>
      </div>
      <p
        className={cn(
          'mt-7 border-t border-white/10 pt-5 text-lg font-medium',
          called ? 'text-[#5ed3a8]' : 'text-[#edf2ef]',
        )}
      >
        {called
          ? 'It’s your turn.'
          : ahead === 0
            ? 'You’re next.'
            : 'Keep this page open. It moves by itself.'}
      </p>
    </div>
  );
}

'use client';

import { motion, useMotionValue, useSpring } from 'motion/react';
import type { PointerEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from './use-reduced-motion';

/**
 * A main button that leans a little toward a mouse near it, on a spring, and settles back when
 * it leaves (D-099). The pattern of motion-primitives' Magnetic (github.com/ibelick/motion-primitives,
 * MIT). Only for a mouse (a finger has nothing to lean toward) and never under reduced motion;
 * it moves the wrapper, so the button's own press feedback is untouched.
 */
export function Magnetic({
  children,
  strength = 0.22,
  className,
}: {
  children: ReactNode;
  /** How far it follows, as a share of the pointer's distance from its centre. */
  strength?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18, mass: 0.4 });
  const move = (e: PointerEvent<HTMLSpanElement>) => {
    if (reduce || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const leave = () => {
    x.set(0);
    y.set(0);
  };
  return (
    <motion.span
      className={cn('inline-flex', className)}
      style={{ x, y }}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {children}
    </motion.span>
  );
}

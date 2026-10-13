'use client';

import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  wrap,
} from 'motion/react';
import { Fragment } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from './use-reduced-motion';

/**
 * A line of words that moves only while the page scrolls: in the scroll's direction, faster
 * with faster scrolling, and still when the page is still (D-099). Adapted from componentry's
 * ScrollBasedVelocity (github.com/harshjdhv/componentry, MIT, © 2026 Harsh Jadhav); unlike the
 * original it never drifts on its own, so nothing moves without the visitor (WCAG 2.2.2), and
 * under reduced motion it's a still line. Decorative: the words are on the page anyway.
 */
export function ScrollMarquee({ items, className }: { items: readonly string[]; className?: string }) {
  const reduce = useReducedMotion();
  const offset = useMotionValue(0);
  const { scrollY } = useScroll();
  const speed = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  // Two copies side by side: moving within one copy's width loops without a seam.
  const x = useTransform(offset, (v) => `${wrap(-50, 0, v)}%`);

  useAnimationFrame((_, delta) => {
    if (reduce) return;
    const v = speed.get(); // pixels a second; positive while scrolling down
    if (Math.abs(v) < 2) return;
    offset.set(offset.get() - v * (delta / 1000) * 0.012);
  });

  const line = (copy: number) => (
    <span className="flex shrink-0 items-center" aria-hidden={copy > 0 || undefined}>
      {items.map((item) => (
        <Fragment key={`${copy}-${item}`}>
          <span className="whitespace-nowrap">{item}</span>
          <span
            aria-hidden
            className="mx-[0.45em] inline-block size-[0.22em] shrink-0 rounded-full bg-spark"
          />
        </Fragment>
      ))}
    </span>
  );

  return (
    <div aria-hidden className={cn('overflow-hidden', className)}>
      <motion.div className="flex w-max" style={{ x }}>
        {line(0)}
        {line(1)}
      </motion.div>
    </div>
  );
}

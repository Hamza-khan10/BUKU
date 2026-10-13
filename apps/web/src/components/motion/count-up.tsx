'use client';

import { animate, useInView } from 'motion/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReducedMotion } from './use-reduced-motion';

/**
 * A real number that rolls up to its value once it comes into view (D-099); the pattern of
 * motion-primitives' AnimatedNumber (github.com/ibelick/motion-primitives, MIT). The server and
 * screen readers get the number itself; only the picture counts, once, and not at all under
 * reduced motion.
 */
const noChange = () => () => undefined;

export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  // Once the page has come to life, the number waits at 0 until it's seen (the server sends the value).
  const alive = useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  );
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '-10% 0px' });
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (!seen || reduce) return;
    const controls = animate(0, value, {
      duration: Math.min(1.4, 0.5 + value / 60),
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [seen, reduce, value]);

  return (
    <span ref={ref} className={className}>
      <span aria-hidden className="tabular">
        {shown ?? (alive && !reduce ? 0 : value)}
      </span>
      <span className="sr-only">{value}</span>
    </span>
  );
}

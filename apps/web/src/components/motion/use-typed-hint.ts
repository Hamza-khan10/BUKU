'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './use-reduced-motion';

/**
 * A search box's placeholder that types two real searches, then rests on its usual hint (3.7i):
 * it shows what the box is for without a word of explanation. About three seconds in all (under
 * WCAG 2.2.2's five for anything that moves on its own), once, only when the box first comes into
 * view, and never while the box has focus or text, or for people who ask for less motion.
 * Placeholders aren't read out as they change, so screen readers hear only the label.
 */
export function useTypedHint(examples: readonly [string, string], rest: string, idle: boolean) {
  const reduce = useReducedMotion();
  const [hint, setHint] = useState(rest);
  const ref = useRef<HTMLInputElement>(null);
  const played = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (reduce || !idle || played.current || !el) {
      setHint(rest);
      return;
    }
    const timers: number[] = [];
    let at = 0;
    const later = (ms: number, text: string) => {
      at += ms;
      timers.push(window.setTimeout(() => setHint(text), at));
    };
    const play = () => {
      played.current = true;
      for (const word of examples) {
        for (let i = 1; i <= word.length; i++) later(i === 1 ? 120 : 55, word.slice(0, i));
        at += 950; // read it
        for (let i = word.length - 1; i >= 0; i--) later(25, word.slice(0, i));
      }
      later(140, rest);
    };
    const watch = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      watch.disconnect();
      play();
    });
    watch.observe(el);
    return () => {
      watch.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
      if (played.current) setHint(rest);
    };
  }, [reduce, idle, examples, rest]);

  return { ref, hint };
}

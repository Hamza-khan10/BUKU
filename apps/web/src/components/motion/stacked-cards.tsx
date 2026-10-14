'use client';

import { useLenis } from 'lenis/react';
import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from './use-reduced-motion';

/**
 * Cards laid one over another as the page scrolls — a deck being put down (D-099, rebuilt in
 * D-102). Each card pins in the same place under the header; the card being covered rises a
 * little, settles back and dims, so the last three show as edges above the one on top and older
 * ones fade away. Nothing of a covered card ever shows below the card on top, whatever their
 * heights (a short card can cover a tall one). The pattern of componentry's Sticky Scroll
 * Cards (github.com/harshjdhv/componentry, MIT, © 2026 Harsh Jadhav), rebuilt for BUKU.
 *
 * It stacks only where every card fits on the screen whole while pinned — measured, and measured
 * again whenever the window or a card changes size — because a pinned card never scrolls: a
 * taller one would hide its own last lines. Otherwise, and for people who ask for less motion,
 * it's a plain list whose cards rise in (without fading, so their text keeps its contrast). Keyboard focus inside a covered card brings that card
 * back into view (WCAG 2.4.11). `stackTarget` gives the scroll position that shows a card.
 */

const TOP_REM = 5.5; // under the site header
const STEP_REM = 0.75; // how much of each covered card still shows above the next
const DEPTH = 3; // covered cards that still show as edges
const PIN_REM = TOP_REM + DEPTH * STEP_REM; // where every card pins
const GAP_REM = 1.5;
const MIN_WIDTH_REM = 40;

interface Metrics {
  rem: number;
  heights: number[];
  tops: number[];
}

export function StackedCards({
  cards,
  ids,
  className,
}: {
  cards: ReactNode[];
  /** An id for each card, so links can lead to it (`#id`). */
  ids?: (string | undefined)[];
  className?: string;
}) {
  const reduce = useReducedMotion();
  const lenis = useLenis();
  const [stacked, setStacked] = useState(false);
  const deck = useRef<HTMLDivElement>(null);
  const wrappers = useRef<(HTMLDivElement | null)[]>([]);
  const inners = useRef<(HTMLDivElement | null)[]>([]);
  const metrics = useRef<Metrics | null>(null);
  const covered = useRef<number[]>([]);
  const frame = useRef(0);

  const measure = useCallback(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const heights = inners.current.map((el) => el?.offsetHeight ?? 0);
    const tops = heights.map(() => rem * PIN_REM);
    metrics.current = { rem, heights, tops };
    const fits =
      window.innerWidth >= MIN_WIDTH_REM * rem &&
      heights.every((h, i) => tops[i]! + h <= window.innerHeight - rem);
    setStacked(!reduce && fits && cards.length > 1);
    // Where each card is shown whole: its place in the deck, less where it pins.
    const deckTop = (deck.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    let flow = deckTop;
    heights.forEach((h, i) => {
      wrappers.current[i]?.setAttribute('data-stack-target', String(Math.round(flow - tops[i]!)));
      flow += h + GAP_REM * rem;
    });
  }, [reduce, cards.length]);

  /** Every frame the page moves: lift, settle, dim and trim the covered cards (reads, then writes). */
  const paint = useCallback(() => {
    frame.current = 0;
    const m = metrics.current;
    if (!m) return;
    const n = inners.current.length;
    const step = STEP_REM * m.rem;
    const top = wrappers.current.map((el) => el?.getBoundingClientRect().top ?? 0);
    // How far the next card has come over each one (0–1), and how deep under the deck each is.
    const amount = top.map((t, i) =>
      i === n - 1 ? 0 : Math.min(1, Math.max(0, (t + m.heights[i]! - top[i + 1]!) / m.heights[i]!)),
    );
    const depth = new Array<number>(n).fill(0);
    for (let i = n - 2; i >= 0; i--) depth[i] = amount[i]! + depth[i + 1]!;
    const scale = depth.map((d) => 1 - 0.03 * Math.min(d, DEPTH));
    const shown = depth.map((d, i) => top[i]! - step * Math.min(d, DEPTH));
    // Each covered card ends where the cards over it end, but always keeps its own edge.
    const bottom = new Array<number>(n);
    bottom[n - 1] = shown[n - 1]! + m.heights[n - 1]! * scale[n - 1]!;
    for (let i = n - 2; i >= 0; i--) {
      const own = shown[i]! + m.heights[i]! * scale[i]!;
      bottom[i] = amount[i]! > 0 ? Math.max(shown[i + 1]!, Math.min(own, bottom[i + 1]!)) : own;
    }
    covered.current = depth;
    inners.current.forEach((el, i) => {
      if (!el) return;
      const d = depth[i]!;
      const trim = m.heights[i]! - (bottom[i]! - shown[i]!) / scale[i]!;
      el.style.transform = d > 0 ? `translateY(${shown[i]! - top[i]!}px) scale(${scale[i]})` : '';
      el.style.clipPath = trim > 0.5 ? `inset(0 0 ${trim}px 0 round ${m.rem}px)` : '';
      el.style.opacity = d > DEPTH ? String(Math.max(0, DEPTH + 1 - d)) : '';
      el.style.setProperty('--covered', String(Math.min(0.7, 0.4 * d)));
    });
  }, []);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // Measure now, and whenever the window or a card changes size.
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(() => measure());
    if (deck.current) observer.observe(deck.current);
    inners.current.forEach((el) => el && observer.observe(el));
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // Follow the scroll while stacked; leave the cards untouched otherwise.
  useEffect(() => {
    const all = inners.current;
    if (!stacked) {
      all.forEach((el) => {
        if (!el) return;
        el.style.transform = '';
        el.style.clipPath = '';
        el.style.opacity = '';
        el.style.removeProperty('--covered');
      });
      return;
    }
    measure();
    paint();
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [stacked, measure, paint, schedule]);

  // Tabbing into a covered card: bring that card back on top.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!stacked) return;
    const i = wrappers.current.findIndex((el) => el?.contains(event.target));
    if (i < 0 || !(covered.current[i]! > 0.01)) return;
    const target = Number(wrappers.current[i]?.getAttribute('data-stack-target'));
    if (Number.isFinite(target)) {
      if (lenis) lenis.scrollTo(target, { immediate: true });
      else window.scrollTo(0, target);
    }
  };

  return (
    <div ref={deck} className={cn('flex flex-col gap-6', className)} onFocus={onFocus}>
      {cards.map((card, i) => (
        <div
          key={ids?.[i] ?? i}
          id={ids?.[i]}
          ref={(el) => {
            wrappers.current[i] = el;
          }}
          data-stacked={stacked || undefined}
          className={stacked ? (i < cards.length - 1 ? 'sticky' : 'relative') : 'reveal-rise'}
          style={stacked ? { top: `${PIN_REM}rem`, zIndex: i + 1 } : undefined}
        >
          <div
            ref={(el) => {
              inners.current[i] = el;
            }}
            className={cn('relative origin-top', stacked && 'will-change-transform')}
          >
            {card}
            {/* The covered card fades back into the page. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl bg-canvas opacity-[var(--covered,0)]"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The scroll position that shows the card with this id whole (stacked or not), or null. */
export function stackTarget(id: string): number | null {
  const el = document.getElementById(id);
  if (!el) return null;
  const pinned = el.getAttribute('data-stack-target');
  if (pinned !== null && el.hasAttribute('data-stacked')) return Number(pinned);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return el.getBoundingClientRect().top + window.scrollY - PIN_REM * rem;
}

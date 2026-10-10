'use client';

/*
 * Adapted from React Bits' SplitFlapText (github.com/DavidHDev/react-bits, MIT + Commons Clause:
 * used as part of this site, never redistributed on its own). Copyright (c) 2026 David Haz.
 * Changes: driven by a value rather than a word list, styles in globals.css (.flap-*), the text
 * itself available to screen readers, and no flipping under reduced motion.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from './use-reduced-motion';

const DIGITS = '0123456789';

interface Tile {
  current: string;
  next: string;
  flipping: boolean;
  tick: number;
}

const tilesOf = (text: string): Tile[] =>
  [...text].map((c) => ({ current: c, next: c, flipping: false, tick: 0 }));

/**
 * A split-flap display, like a station's departure board: when `value`
 * changes, each character that differs flips through a few others and lands
 * on the new one, left to right. Equal length in, equal length out (pad with
 * spaces or zeros before passing it in).
 */
export function SplitFlap({
  value,
  label,
  charset = DIGITS,
  flips = 6,
  flipMs = 90,
  staggerMs = 70,
  className,
  style,
}: {
  value: string;
  /** What a screen reader hears; defaults to the value. */
  label?: string;
  charset?: string;
  /** Extra characters each tile passes through before it settles. */
  flips?: number;
  flipMs?: number;
  staggerMs?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const [tiles, setTiles] = useState<Tile[]>(() => tilesOf(value));
  const shown = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    const from = shown.current.padEnd(value.length, ' ').slice(0, value.length);
    if (reduce || from === value) {
      shown.current = value;
      setTiles(tilesOf(value));
      return;
    }

    const plans = [...value].flatMap((target, index) => {
      const start = from[index] ?? ' ';
      if (start === target) return [];
      const steps = Array.from({ length: flips }, () => charset[Math.floor(Math.random() * charset.length)]!);
      return [{ index, start, sequence: [...steps, target], step: -1, done: false }];
    });
    const began = performance.now();
    setTiles(tilesOf(from));

    const tick = (now: number) => {
      let running = false;
      const updates: { index: number; current: string; next: string; done: boolean }[] = [];
      for (const plan of plans) {
        const elapsed = now - began - plan.index * staggerMs;
        if (elapsed < 0) {
          running = true;
          continue;
        }
        const step = Math.floor(elapsed / flipMs);
        if (step < plan.sequence.length) {
          running = true;
          if (step !== plan.step) {
            plan.step = step;
            updates.push({
              index: plan.index,
              current: step === 0 ? plan.start : plan.sequence[step - 1]!,
              next: plan.sequence[step]!,
              done: false,
            });
          }
        } else if (!plan.done) {
          plan.done = true;
          const target = plan.sequence.at(-1)!;
          updates.push({ index: plan.index, current: target, next: target, done: true });
        }
      }
      if (updates.length) {
        setTiles((previous) => {
          const next = [...previous];
          for (const u of updates) {
            next[u.index] = {
              current: u.current,
              next: u.next,
              flipping: !u.done,
              tick: (next[u.index]?.tick ?? 0) + 1,
            };
          }
          return next;
        });
      }
      if (running) frame.current = requestAnimationFrame(tick);
      else shown.current = value;
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      shown.current = value;
    };
  }, [value, reduce, charset, flips, flipMs, staggerMs]);

  const blank = (c: string) => (c === ' ' ? ' ' : c);
  return (
    <span className={cn('flap', className)} style={{ '--flap-ms': `${flipMs}ms`, ...style } as CSSProperties}>
      <span className="sr-only">{label ?? value}</span>
      {tiles.map((tile, i) => (
        <span key={i} aria-hidden className="flap-tile">
          <span className="flap-half flap-half-top">
            <span className="flap-char">{blank(tile.current)}</span>
          </span>
          <span className="flap-half flap-half-bottom">
            <span className="flap-char">{blank(tile.flipping ? tile.next : tile.current)}</span>
          </span>
          {tile.flipping && (
            <>
              <span key={`f${tile.tick}`} className="flap-leaf flap-leaf-front">
                <span className="flap-char">{blank(tile.current)}</span>
              </span>
              <span key={`b${tile.tick}`} className="flap-leaf flap-leaf-back">
                <span className="flap-char">{blank(tile.next)}</span>
              </span>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

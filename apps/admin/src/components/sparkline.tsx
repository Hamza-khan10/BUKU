'use client';

import { useId, useRef, useState } from 'react';

export type Point = [time: number, value: number];

/** How the values read (formatted here: a server page can't pass a function to the browser). */
export type Unit = 'per-second' | 'percent' | 'millis';
const FORMAT: Record<Unit, (v: number) => string> = {
  'per-second': (v) => `${v.toFixed(2)}/s`,
  percent: (v) => `${v.toFixed(2)}%`,
  millis: (v) => `${Math.round(v * 1000)} ms`,
};

const W = 240;
const H = 52;
const PAD = 4;

const clock = (t: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(t * 1000),
  ) + ' UTC';

/**
 * The last hour of one measure, under its number (the stat tile's trend). One series, so no legend:
 * the tile names it. The line is emerald, or the tone's colour when the tile is in trouble; the
 * current minute is marked. Hovering reads any minute; the same facts are in the accessible name
 * (start, high, now), so the hover only adds detail, never hides it.
 */
export function Sparkline({
  points,
  label,
  unit,
  tone = 'brand',
}: {
  points: Point[] | null;
  label: string;
  unit: Unit;
  tone?: 'brand' | 'wait' | 'danger';
}) {
  const format = FORMAT[unit];
  const gradient = useId();
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<number | null>(null);

  if (!points || points.length < 2) {
    return (
      <div className="flex h-[52px] items-center">
        <span className="h-px w-full bg-line" />
        <span className="sr-only">{label}: no history yet.</span>
      </div>
    );
  }

  const values = points.map((p) => p[1]);
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const last = points.length - 1;
  const shown = at ?? last;
  const colour = tone === 'danger' ? 'var(--danger)' : tone === 'wait' ? 'var(--wait)' : 'var(--brand)';
  const summary = `${label}, last hour: ${format(values[0]!)} an hour ago, high ${format(max)}, now ${format(values[last]!)}.`;

  const track = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setAt(Math.round(ratio * last));
  };

  return (
    <div
      ref={box}
      className="relative h-[52px] touch-none select-none"
      onPointerMove={(e) => track(e.clientX)}
      onPointerDown={(e) => track(e.clientX)}
      onPointerLeave={() => setAt(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
        className="size-full"
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity="0.22" />
            <stop offset="100%" stopColor={colour} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradient})`} />
        <path
          d={line}
          fill="none"
          stroke={colour}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {at !== null && (
          <line
            x1={x(shown)}
            x2={x(shown)}
            y1={0}
            y2={H}
            stroke="var(--control)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* Dots drawn in HTML so they stay round however the line is stretched. */}
      <span
        aria-hidden
        className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
        style={{
          left: `${(x(shown) / W) * 100}%`,
          top: `${(y(values[shown]!) / H) * 100}%`,
          background: colour,
        }}
      />
      {at !== null && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-2 py-1 text-xs whitespace-nowrap shadow-lg"
          style={{ left: `${Math.min(88, Math.max(12, (x(shown) / W) * 100))}%` }}
        >
          <strong className="font-semibold text-ink tabular-nums">{format(values[shown]!)}</strong>
          <span className="text-ink-3"> · {clock(points[shown]![0])}</span>
        </span>
      )}
    </div>
  );
}

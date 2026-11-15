'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { niceTicks } from '../insights';

/**
 * The charts on Insights (3.5j), drawn by the dataviz method: thin columns (at most 24px) with a
 * 4px rounded top, square on the baseline, a 2px gap between stacked parts; hairline gridlines; a
 * key whenever there are two or more series; values in ink, never in the series colour. Hovering
 * or focusing a column shows its numbers; every number is also in a table, so nothing is hover-only.
 */

export interface Series {
  key: string;
  label: string;
  /** A CSS colour, from the theme's series tokens. */
  color: string;
}

export interface Column {
  key: string;
  /** The label under the column, or null where labels would crowd. */
  axis: string | null;
  /** What the column is, in full ("Week of 3 Nov"). */
  title: string;
  values: Record<string, number>;
  /** One more line for the readout ("12 booked"). */
  note?: string;
}

const PLOT = 176; // px

/** The key: a small square of each series' colour, then its name. */
export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Columns, each a stack of the series (the first at the bottom). One tab stop for the whole chart:
 * the arrow keys move between columns, and each column names its own numbers to screen readers.
 */
export function StackedColumns({
  label,
  series,
  columns,
}: {
  label: string;
  series: Series[];
  columns: Column[];
}) {
  const totals = columns.map((c) => series.reduce((n, s) => n + (c.values[s.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1]!;
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (e: KeyboardEvent, i: number) => {
    const to =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? columns.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    const j = Math.min(columns.length - 1, Math.max(0, to));
    setActive(j);
    refs.current[j]?.focus();
  };
  // The readout's numbers, top of the stack first, as the eye meets them.
  const rows = (c: Column) => [...series].reverse().map((s) => ({ s, value: c.values[s.key] ?? 0 }));
  const sentence = (c: Column) =>
    [
      `${c.title}:`,
      rows(c)
        .map((r) => `${r.value} ${r.s.label.toLowerCase()}`)
        .join(', '),
      c.note ? `(${c.note})` : '',
    ]
      .filter(Boolean)
      .join(' ');
  const at = shown === null ? null : columns[shown];

  return (
    <div className="flex gap-2">
      <div
        aria-hidden
        className="relative w-7 shrink-0 text-right text-xs text-ink-3 tabular-nums"
        style={{ height: PLOT }}
      >
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute right-0 translate-y-1/2 leading-none"
            style={{ bottom: `${(t / top) * 100}%` }}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" style={{ height: PLOT }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute inset-x-0 h-px bg-line"
              style={{ bottom: `${(t / top) * 100}%` }}
            />
          ))}
        </div>
        <div
          role="group"
          aria-label={label}
          className="relative flex items-end"
          style={{ height: PLOT }}
          onPointerLeave={() => setShown(null)}
        >
          {columns.map((c, i) => {
            const parts = series.map((s) => ({ s, value: c.values[s.key] ?? 0 })).filter((p) => p.value > 0);
            return (
              <button
                key={c.key}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                tabIndex={i === active ? 0 : -1}
                aria-label={sentence(c)}
                onPointerEnter={() => setShown(i)}
                onFocus={() => {
                  setActive(i);
                  setShown(i);
                }}
                onBlur={() => setShown(null)}
                onKeyDown={(e) => move(e, i)}
                className={cn(
                  'relative flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-md outline-none',
                  'focus-visible:ring-2 focus-visible:ring-focus',
                  shown === i && 'bg-sunken/80',
                )}
              >
                <span
                  aria-hidden
                  className="flex w-full max-w-6 flex-col-reverse gap-[2px] px-px"
                  style={{ height: (totals[i]! / top) * PLOT }}
                >
                  {parts.map((p, k) => (
                    <span
                      key={p.s.key}
                      className={cn('min-h-px w-full basis-0', k === parts.length - 1 && 'rounded-t-[4px]')}
                      style={{ flexGrow: p.value, background: p.s.color }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        {at && shown !== null && <Readout column={at} rows={rows(at)} index={shown} count={columns.length} />}
        <div aria-hidden className="mt-2 flex h-4 text-xs text-ink-3">
          {columns.map((c) => (
            <span key={c.key} className="relative min-w-0 flex-1">
              {c.axis && (
                <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{c.axis}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The hovered column's numbers: the value strong, the series name after it, a short line as its key. */
function Readout({
  column,
  rows,
  index,
  count,
}: {
  column: Column;
  rows: { s: Series; value: number }[];
  index: number;
  count: number;
}) {
  const x = ((index + 0.5) / count) * 100;
  // Beside the column's mark (at most 24px wide), never over it: to its left in the chart's right
  // half, to its right in the left half, so it always opens towards the room.
  const shift = x > 50 ? 'calc(-100% - 20px)' : '20px';
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 z-10 w-max max-w-56 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lift"
      style={{ left: `${x}%`, transform: `translateX(${shift})` }}
    >
      <p className="font-medium text-ink">{column.title}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {rows.map(({ s, value }) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="font-semibold text-ink tabular-nums">{value}</span>
            <span className="text-ink-2">{s.label}</span>
          </li>
        ))}
      </ul>
      {column.note && <p className="mt-1.5 text-ink-3">{column.note}</p>}
    </div>
  );
}

/**
 * Bars ranked largest first, one colour: the name above each, its number at the bar's end. Every
 * value is printed, so there is nothing to hover for.
 */
export function RankedBars({
  label,
  color,
  rows,
}: {
  label: string;
  color: string;
  rows: { key: string; label: string; value: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="flex flex-col gap-3.5">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-2">
            {r.label}
            <span className="sr-only">: {r.value}</span>
          </span>
          <span aria-hidden className="flex items-center gap-2">
            <span
              className="h-3 rounded-r-[4px]"
              style={{ width: `calc((100% - 2.5rem) * ${r.value / max})`, minWidth: 2, background: color }}
            />
            <span className="text-sm font-semibold text-ink tabular-nums">{r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A chart's numbers as a table, folded away until asked for. */
export function NumbersTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <details className="group text-sm">
      <summary className="w-fit cursor-pointer rounded-md text-ink-2 hover:text-ink">See the numbers</summary>
      <DataTable caption={caption} headers={headers} rows={rows} className="mt-3" />
    </details>
  );
}

/**
 * A plain table: the first column names the row, the rest are numbers, right-aligned to compare.
 * On a phone it scrolls sideways, so its box takes keyboard focus (the arrow keys scroll it).
 */
export function DataTable({
  caption,
  headers,
  rows,
  className,
}: {
  caption: string;
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn(
        'overflow-x-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus',
        className,
      )}
    >
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-ink-3">
            {headers.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn('py-2 font-medium', i === 0 ? 'pr-4 text-left' : 'pl-4 text-right')}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-0">
              {r.cells.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="py-2.5 pr-4 text-left font-medium text-ink">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className="py-2.5 pl-4 text-right text-ink-2 tabular-nums">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A headline number: what it counts, the number, and a line of what it's made of. */
export function StatTile({ label, value, detail }: { label: string; value: string; detail: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-soft">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">{value}</dd>
      <dd className="mt-1 text-sm text-ink-3">{detail}</dd>
    </div>
  );
}

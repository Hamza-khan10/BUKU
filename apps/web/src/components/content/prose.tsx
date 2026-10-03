import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * Long-form text (legal pages, help, security): comfortable line length and
 * spacing, clear headings, readable tables that scroll sideways on phones.
 */
export function Prose({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'max-w-[70ch] text-[1.0625rem] leading-relaxed text-ink-2',
        '[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink',
        '[&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink',
        '[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-2',
        '[&_strong]:font-semibold [&_strong]:text-ink',
        '[&_a]:font-medium [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:no-underline',
        '[&_code]:rounded [&_code]:bg-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-ink',
        className,
      )}
      {...props}
    />
  );
}

/** A table inside prose: scrolls sideways on narrow screens instead of breaking the page. */
export function ProseTable({
  head,
  rows,
  caption,
}: {
  head: string[];
  rows: React.ReactNode[][];
  caption?: string;
}) {
  return (
    // Focusable and named, so keyboard users can scroll it on narrow screens too.
    <div
      role="region"
      aria-label={caption ?? 'Table'}
      tabIndex={0}
      className="mt-6 overflow-x-auto rounded-md border border-line"
    >
      <table className="w-full min-w-[36rem] border-collapse text-left text-[0.95rem]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-sunken text-ink">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line align-top">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

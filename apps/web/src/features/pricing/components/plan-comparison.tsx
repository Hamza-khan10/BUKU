import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { COMPARISON, LAUNCH_PLANS } from '../launch-plans';

const COLUMNS = [
  ...LAUNCH_PLANS.map((p) => ({ id: p.id, name: p.name, suggested: p.suggested })),
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    suggested: undefined,
  },
];

/**
 * Every plan side by side (D-137): a real table, so a screen reader can say which plan a tick
 * belongs to. On a phone it scrolls sideways with the feature names kept in view. The scroller is
 * `relative` so the screen-reader words in the cells (absolutely placed) stay inside it, instead of
 * stretching the whole page sideways.
 */
export function PlanComparison() {
  return (
    <div
      role="region"
      aria-labelledby="compare-title"
      tabIndex={0}
      className="relative -mx-4 overflow-x-auto px-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus/20 sm:mx-0 sm:px-0"
    >
      <table className="w-full min-w-[38rem] border-separate border-spacing-0 text-left sm:min-w-[46rem]">
        <caption className="sr-only">What each plan includes</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-36 bg-canvas pb-4 align-bottom sm:w-[34%]">
              <span className="sr-only">Feature</span>
            </th>
            {COLUMNS.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cn(
                  'px-3 pb-4 text-center align-bottom text-[0.95rem] font-semibold tracking-[-0.01em]',
                  c.suggested ? 'text-brand-ink' : 'text-ink',
                )}
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        {COMPARISON.map(({ group, rows }) => (
          <tbody key={group}>
            <tr>
              <th
                scope="colgroup"
                colSpan={COLUMNS.length + 1}
                className="sticky left-0 bg-canvas pt-6 pb-2 text-sm font-semibold text-ink"
              >
                {group}
              </th>
            </tr>
            {rows.map((row) => (
              <tr key={row.label} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-t border-line bg-canvas py-3.5 pr-3 text-sm leading-snug font-normal text-ink-2 sm:pr-4 sm:text-[0.95rem]"
                >
                  {row.label}
                </th>
                {COLUMNS.map((c) => {
                  const v = row.values[c.id];
                  return (
                    <td
                      key={c.id}
                      className={cn(
                        'border-t border-line px-3 py-3.5 text-center text-[0.95rem] text-ink',
                        c.suggested && 'bg-brand-soft/35',
                      )}
                    >
                      {v === true ? (
                        <>
                          <Check
                            aria-hidden
                            className="mx-auto size-[1.1rem] text-brand-ink"
                            strokeWidth={2.5}
                          />
                          <span className="sr-only">Included</span>
                        </>
                      ) : v === false ? (
                        <>
                          <Minus aria-hidden className="mx-auto size-4 text-ink-3" />
                          <span className="sr-only">Not included</span>
                        </>
                      ) : (
                        <span className="tabular">{v}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

import { Check, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import type { Plan, Pricing } from '../api';

const per = (interval: 'month' | 'year') => (interval === 'month' ? 'month' : 'year');

/** "$1.99 / month", or "Free". */
export function PriceTag({ plan }: { plan: Plan }) {
  const price = plan.prices[0];
  if (plan.free || !price) {
    return <p className="text-4xl font-semibold tracking-[-0.03em]">Free</p>;
  }
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-4xl font-semibold tracking-[-0.03em] tabular">
        {money(price.amount, price.currency)}
      </span>
      <span className="text-ink-3">/ {per(price.interval)}</span>
    </p>
  );
}

/** One plan: its name, price, the trial if this is the trial plan, and its own words for what it includes. */
export function PlanCard({
  plan,
  trial,
  highlight,
}: {
  plan: Plan;
  trial: Pricing['trial'];
  highlight?: boolean;
}) {
  const hasTrial = trial?.plan.code === plan.code;
  return (
    <article
      className={cn(
        'flex h-full flex-col gap-5 rounded-xl border bg-surface p-6 shadow-soft',
        highlight ? 'border-brand ring-1 ring-brand' : 'border-line',
      )}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl tracking-[-0.02em] font-semibold">{plan.name}</h3>
          {hasTrial && <Badge tone="brand">{trial.days}-day free trial</Badge>}
        </div>
        {plan.tagline && <p className="text-sm text-ink-2">{plan.tagline}</p>}
      </header>
      <PriceTag plan={plan} />
      <ul className="flex flex-col gap-2.5">
        {plan.benefits.map((b) => (
          <li key={b} className="flex items-start gap-2 text-ink-2">
            <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            {b}
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * Limits and features side by side. Only what the catalog says — features BUKU
 * doesn't offer yet aren't listed. The scroll area is `relative` so the
 * screen-reader labels inside it (positioned absolutely) scroll with the table
 * instead of widening the page.
 */
export function ComparisonTable({ pricing }: { pricing: Pricing }) {
  const { plans, comparison } = pricing;
  if (plans.length < 2 || comparison.limits.length + comparison.features.length === 0) return null;
  const cell = 'px-4 py-3 text-center';
  return (
    <div
      role="region"
      aria-label="Compare plans"
      tabIndex={0}
      className="relative overflow-x-auto rounded-lg border border-line"
    >
      <table className="w-full min-w-[36rem] border-collapse text-[0.95rem]">
        <caption className="sr-only">What each plan includes</caption>
        <thead className="bg-sunken">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-semibold">
              <span className="sr-only">Included</span>
            </th>
            {plans.map((p) => (
              <th key={p.code} scope="col" className={cn(cell, 'font-semibold')}>
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.limits.map((l) => (
            <tr key={l.key} className="border-t border-line">
              <th scope="row" className="px-4 py-3 text-left font-medium">
                {l.label}
                <span className="block text-xs font-normal text-ink-3">{l.description}</span>
              </th>
              {plans.map((p) => {
                const v = p.limits[l.key];
                return (
                  <td key={p.code} className={cn(cell, 'tabular')}>
                    {v === null || v === undefined ? 'Unlimited' : v}
                  </td>
                );
              })}
            </tr>
          ))}
          {comparison.features.map((f) => (
            <tr key={f.key} className="border-t border-line">
              <th scope="row" className="px-4 py-3 text-left font-medium">
                {f.label}
                <span className="block text-xs font-normal text-ink-3">{f.description}</span>
              </th>
              {plans.map((p) => (
                <td key={p.code} className={cell}>
                  {p.features[f.key] ? (
                    <>
                      <Check className="mx-auto size-5 text-ok" aria-hidden />
                      <span className="sr-only">Included</span>
                    </>
                  ) : (
                    <>
                      <Minus className="mx-auto size-5 text-ink-3" aria-hidden />
                      <span className="sr-only">Not included</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

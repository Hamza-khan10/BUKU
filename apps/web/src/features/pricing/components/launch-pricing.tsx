'use client';

import { Check } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  CURRENCIES,
  LAUNCH_PLANS,
  MONTHS_PER_YEAR_PAID,
  money,
  priceFor,
  TRIAL_DAYS,
  type Currency,
  type LaunchPlan,
  type Period,
} from '../launch-plans';

/**
 * The plans for businesses at launch (D-137), with the two choices that change a price: how often
 * it's paid, and in which currency. Rupees in Pakistan, dollars elsewhere, chosen by where the
 * visitor is, and theirs to switch.
 */
export function LaunchPricing({
  initialCurrency,
  early,
}: {
  initialCurrency: Currency;
  /** Before launch, every plan leads to the early-access list. */
  early: boolean;
}) {
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [period, setPeriod] = useState<Period>('month');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          legend="Billed"
          name="period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'month', label: 'Monthly' },
            {
              value: 'year',
              label: 'Yearly',
              note: `${12 - MONTHS_PER_YEAR_PAID} months free`,
            },
          ]}
        />
        <Segmented
          legend="Currency"
          name="currency"
          value={currency}
          onChange={setCurrency}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
      </div>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LAUNCH_PLANS.map((plan, i) => (
          <li key={plan.id} className="flex">
            <PlanCard
              plan={plan}
              previous={i > 0 ? LAUNCH_PLANS[i - 1]! : null}
              currency={currency}
              period={period}
              early={early}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({
  plan,
  previous,
  currency,
  period,
  early,
}: {
  plan: LaunchPlan;
  previous: LaunchPlan | null;
  currency: Currency;
  period: Period;
  early: boolean;
}) {
  const free = plan.monthly[currency] === 0;
  const { perMonth, billed } = priceFor(plan, currency, period);
  const heading = `plan-${plan.id}`;
  // Network's price is for each branch, from two: what the smallest bill is, and what each branch
  // saves against the plan before it (Professional) on its own, so $29 never reads as a cheaper
  // Professional.
  const saving = plan.perBranch && previous ? priceFor(previous, currency, period).billed - billed : 0;
  const includes =
    saving > 0
      ? [
          `Each branch ${money(saving, currency)} a ${period} less than ${previous!.name} on its own`,
          ...plan.includes,
        ]
      : plan.includes;
  const href = (
    early ? `/early-access?as=business&plan=${plan.id}&source=pricing` : '/business/new'
  ) as Route;

  return (
    <article
      aria-labelledby={heading}
      className={cn(
        'relative flex w-full flex-col gap-6 rounded-xl bg-surface p-6 ring-1 ring-line',
        plan.suggested ? 'shadow-lift ring-2 ring-brand' : 'shadow-soft',
      )}
    >
      {plan.suggested && (
        <p className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-on-brand">
          Try it free for {TRIAL_DAYS} days
        </p>
      )}
      <header className="flex flex-col gap-1.5">
        <h3 id={heading} className="text-xl font-semibold tracking-[-0.02em] text-ink">
          {plan.name}
        </h3>
        {/* Two lines kept for every plan, so the prices and buttons line up across the row. */}
        <p className="text-sm leading-snug text-ink-2 md:min-h-[2lh]">{plan.forWhom}</p>
      </header>

      <div className="flex min-h-[5.5rem] flex-col gap-1">
        <p className="flex items-baseline gap-1.5">
          <span className="tabular text-[2.6rem] leading-none font-semibold tracking-[-0.045em] whitespace-nowrap text-ink">
            {free ? 'Free' : money(perMonth, currency)}
          </span>
          {!free && <span className="text-sm whitespace-nowrap text-ink-2">/ month</span>}
        </p>
        <p className="text-sm text-ink-3">
          {free ? (
            'For good, no card needed'
          ) : plan.perBranch ? (
            <>
              {period === 'year' ? 'Per branch, billed yearly.' : 'Per branch.'}{' '}
              <span className="whitespace-nowrap">
                Two branches: {money(billed * 2, currency)} a {period}.
              </span>
            </>
          ) : period === 'year' ? (
            `${money(billed, currency)} billed yearly`
          ) : (
            'Billed monthly'
          )}
        </p>
      </div>

      <Button asChild variant={plan.suggested ? 'primary' : 'secondary'} block>
        <Link href={href}>
          {early ? 'Join early access' : free ? 'Start free' : `Choose ${plan.name}`}
          <span className="sr-only"> with {plan.name}</span>
        </Link>
      </Button>

      <div className="flex flex-col gap-3 border-t border-line pt-5">
        {previous && <p className="text-sm font-medium text-ink">Everything in {previous.name}, plus:</p>}
        <ul className="flex flex-col gap-2.5">
          {includes.map((line) => (
            <li key={line} className="flex gap-2.5 text-[0.95rem] leading-snug text-ink-2">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-ink" strokeWidth={2.5} />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** Two or three choices side by side, as a pill: real radio buttons underneath. */
function Segmented<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; note?: string }[];
}) {
  return (
    <fieldset className="flex">
      <legend className="sr-only">{legend}</legend>
      <div className="flex rounded-full bg-sunken p-1 ring-1 ring-line ring-inset">
        {options.map((o) => {
          const chosen = o.value === value;
          return (
            <label
              key={o.value}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out)',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                chosen ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink',
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={chosen}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
              {o.note && (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">
                  {o.note}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

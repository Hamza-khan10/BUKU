'use client';

import { useState, type FormEvent } from 'react';
import { CHANNELS, type Economics } from '@admin/lib/billing';
import { post } from '@admin/lib/client';
import { Button, inputClass, Notice, Stat } from './ui';

const usd = (amount: string) => {
  const n = Number(amount);
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * The economics (3.6j): what a month looks like with the subscribers we have, or with the ones
 * you type in ("what if 200 businesses were on Essential?"), at a tax rate you choose. Profit is
 * after the stores' fees, tax and running costs. Nothing is changed: it's a calculation.
 */
export function EconomicsCalculator({ initial }: { initial: Economics }) {
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const subscribers = Object.fromEntries(
      result.prices
        .filter((p) => form.has(`subs-${p.priceId}`))
        .map((p) => [p.priceId, Math.max(0, Math.round(Number(form.get(`subs-${p.priceId}`)) || 0))]),
    );
    setBusy(true);
    setError(null);
    const answer = await post<Economics>('/api/billing/economics', {
      taxPercent: Number(form.get('tax')) || 0,
      subscribers,
    });
    setBusy(false);
    if (answer.ok) setResult(answer.data);
    else setError(answer.message);
  };

  const t = result.totals;
  // Customers use BUKU for free (D-101): their plans' prices stay in the catalogue but not here.
  const rows = result.prices.filter((p) => !p.plan.startsWith('user_'));
  const left = result.prices.length - rows.length;
  const profit = Number(t.profitPerMonth);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Customers pay a month"
          value={usd(t.customersPayPerMonth)}
          hint={`${t.subscribers} ${t.subscribers === 1 ? 'subscriber' : 'subscribers'}, USD prices`}
        />
        <Stat
          label="BUKU keeps a month"
          value={usd(t.netRevenuePerMonth)}
          hint="After tax and the stores’ fees"
        />
        <Stat
          label="Running costs a month"
          value={usd(t.costsPerMonth)}
          hint="Servers, messages, software…"
        />
        <Stat
          label="Profit a month"
          value={usd(t.profitPerMonth)}
          tone={profit < 0 ? 'danger' : 'neutral'}
          hint={t.marginPercent === null ? 'No revenue yet' : `${t.marginPercent}% of what BUKU keeps`}
        />
      </div>

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Tax on top of prices (%)
            <input
              name="tax"
              type="number"
              min={0}
              max={100}
              step={0.1}
              defaultValue={result.assumptions.taxPercent}
              className={inputClass.replace('w-full', 'w-36')}
            />
          </label>
          <Button type="submit" busy={busy}>
            Work it out
          </Button>
          <p className="text-xs text-ink-3">Type any number of subscribers per price to see “what if”.</p>
        </div>
        {error && <Notice tone="danger" title={error} />}
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[56rem]">
            <caption className="sr-only">Each price, per subscriber a month, and in total</caption>
            <thead>
              <tr>
                <th scope="col">Plan and where</th>
                <th scope="col">Customer pays</th>
                <th scope="col">Tax</th>
                <th scope="col">Store keeps</th>
                <th scope="col">BUKU keeps</th>
                <th scope="col">Subscribers</th>
                <th scope="col">A month</th>
                <th scope="col">Covers costs at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.priceId}>
                  <td>
                    <p className="font-medium text-ink">{p.planName}</p>
                    <p className="text-xs text-ink-3">
                      {CHANNELS[p.channel]} · {p.currency} {p.price}/{p.interval}
                      {!p.includedInTotals && ' · not in totals (not USD)'}
                    </p>
                  </td>
                  <td className="tabular-nums">{p.perSubscriberPerMonth.customerPays}</td>
                  <td className="text-ink-2 tabular-nums">{p.perSubscriberPerMonth.tax}</td>
                  <td className="text-ink-2 tabular-nums">{p.perSubscriberPerMonth.channelFee}</td>
                  <td className="font-medium tabular-nums">
                    {p.perSubscriberPerMonth.net}
                    <span className="ml-1 text-xs font-normal text-ink-3">
                      ({p.perSubscriberPerMonth.keepPercent}%)
                    </span>
                  </td>
                  <td>
                    <input
                      name={`subs-${p.priceId}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={p.subscribers}
                      aria-label={`Subscribers on ${p.planName}, ${CHANNELS[p.channel]}`}
                      className={inputClass.replace('h-11 w-full', 'h-9 w-24')}
                    />
                  </td>
                  <td className="font-medium tabular-nums">{p.monthlyNet}</td>
                  <td className="text-ink-2 tabular-nums">
                    {p.breakEvenSubscribers === null
                      ? '—'
                      : `${p.breakEvenSubscribers.toLocaleString('en-US')} subscribers`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {left > 0 && (
          <p className="text-xs text-ink-3">Customer plans are left out: customers use BUKU for free.</p>
        )}
      </form>
    </div>
  );
}

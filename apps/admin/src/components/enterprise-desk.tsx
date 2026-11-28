'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { money, TERMS, tierRange, type Quote, type Term } from '@admin/lib/enterprise';
import { Button, inputClass, Notice, Stat } from './ui';

const labelClass = 'flex flex-col gap-1 text-xs font-medium text-ink-2';
const today = () => new Date().toISOString().slice(0, 10);
const percent = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

/**
 * Quote a chain and record the deal (D-151): the number of branches, how often they pay and any
 * discount they asked for, worked out from the rate card (nothing saved); then, when they agree,
 * the deal at that price, for the chain of the branch named.
 */
export function EnterpriseDesk({ currencies }: { currencies: string[] }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  if (currencies.length === 0) {
    return (
      <Notice tone="info" title="Set a rate card first">
        Quotes are worked out from it: fill in the tiers and terms below, in rupees, dollars or both.
      </Notice>
    );
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const asked = fieldText(form, 'asked');
    setBusy(true);
    setError(null);
    setRecording(false);
    const result = await post<Quote>('/api/billing/enterprise/quote', {
      currency: fieldText(form, 'currency'),
      branches: Number(fieldText(form, 'branches')),
      term: fieldText(form, 'term'),
      ...(asked && { askedDiscountPercent: Number(asked) }),
    });
    setBusy(false);
    if (result.ok) setQuote(result.data);
    else {
      setQuote(null);
      setError(result.message);
    }
  };

  const q = quote;
  const m = (amount: string) => (q ? money(amount, q.currency) : '');
  const margin = q?.marginPercent ?? null;
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Currency
          <select
            name="currency"
            defaultValue={currencies[0]}
            className={inputClass.replace('w-full', 'w-28')}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Branches
          <input
            name="branches"
            type="number"
            required
            min={1}
            max={100000}
            step={1}
            defaultValue={25}
            className={inputClass.replace('w-full', 'w-28')}
          />
        </label>
        <label className={labelClass}>
          How often they pay
          <select name="term" defaultValue="month" className={inputClass.replace('w-full', 'w-44')}>
            {Object.entries(TERMS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Discount they asked (%)
          <input
            name="asked"
            type="number"
            min={0}
            max={100}
            step={0.01}
            placeholder="None"
            className={inputClass.replace('w-full', 'w-36')}
          />
        </label>
        <Button type="submit" busy={busy}>
          Work out the quote
        </Button>
      </form>

      {error && <Notice tone="wait" title={error} />}

      {q && (
        <section aria-label="The quote" aria-live="polite" className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="A branch a month"
              value={m(q.perBranch)}
              hint={`List ${m(q.tier.price)}, floor ${m(q.tier.floor)}`}
            />
            <Stat
              label={`${q.branches} branches a month`}
              value={m(q.monthly)}
              hint={`List price ${m(q.listMonthly)}`}
            />
            <Stat
              label={q.months === 1 ? 'Each invoice (a month)' : `Each invoice (${q.months} months)`}
              value={m(q.invoice)}
              hint={`They withhold ${m(q.withheld)} of it as tax`}
            />
            <Stat
              label="BUKU keeps a month"
              value={m(q.marginMonthly)}
              tone={margin !== null && margin < 0 ? 'danger' : 'neutral'}
              hint={`${margin === null ? 'Nothing charged' : `${percent(margin)} of the price`}, after ${m(q.costMonthly)} to run its branches`}
            />
          </div>

          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-3">Tier</dt>
              <dd className="text-ink">
                {tierRange(q.tier.fromBranches, q.tier.toBranches)}: {m(q.tier.price)} a branch
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Taken off</dt>
              <dd className="text-ink">
                {q.discounts.termPercent > 0
                  ? `${percent(q.discounts.termPercent)} for paying ${q.term === 'year' ? 'a year' : 'two years'} ahead`
                  : 'Nothing for paying ahead (monthly)'}
                {q.discounts.asked > 0 &&
                  `; ${percent(q.discounts.given)} of the ${percent(q.discounts.asked)} they asked`}
                {q.discounts.limitedBy === 'chain_size' && ' (chains this size can’t ask for more)'}
                {q.discounts.limitedBy === 'most' && ' (the most BUKU gives)'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">The least BUKU takes a month</dt>
              <dd className="text-ink">
                {m(q.floorMonthly)}: every branch at the tier’s floor. Below it, walk away.
              </dd>
            </div>
            {(q.heldAtFloor || q.heldAtTier) && (
              <div>
                <dt className="text-ink-3">Held</dt>
                <dd className="text-ink">
                  {q.heldAtFloor && 'The discounts reached the floor: the price stopped there. '}
                  {q.heldAtTier &&
                    `${q.branches} branches pay what ${q.heldAtTier.fromBranches} would (${m(q.heldAtTier.monthly)} a month): one more branch never costs less.`}
                </dd>
              </div>
            )}
          </dl>

          {recording ? (
            <DealForm quote={q} onDone={() => setRecording(false)} />
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setRecording(true)}>
                Record the deal at {m(q.perBranch)} a branch
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** The deal at the quoted price, for the chain of the branch named (its ID from the console). */
function DealForm({ quote, onDone }: { quote: Quote; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const endsOn = fieldText(form, 'endsOn');
    const notes = fieldText(form, 'notes');
    setBusy(true);
    setError(null);
    const result = await post('/api/billing/enterprise/deals', {
      businessId: fieldText(form, 'businessId'),
      name: fieldText(form, 'name'),
      currency: quote.currency,
      term: fieldText(form, 'term') as Term,
      pricePerBranch: Number(fieldText(form, 'price')),
      startsOn: fieldText(form, 'startsOn'),
      ...(endsOn && { endsOn }),
      ...(notes && { notes }),
    });
    setBusy(false);
    if (result.ok) {
      onDone();
      router.refresh();
    } else setError(result.message);
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Record the deal"
      className="panel flex flex-col gap-4 p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className={labelClass}>
          A branch’s ID
          <input
            name="businessId"
            required
            pattern="[0-9A-Za-z]{12}"
            title="12 letters and digits"
            autoComplete="off"
            className={`${inputClass} font-mono`}
          />
          <span className="font-normal text-ink-3">Any branch: the deal covers the whole chain.</span>
        </label>
        <label className={labelClass}>
          The chain’s name
          <input name="name" required minLength={2} maxLength={160} className={inputClass} />
        </label>
        <label className={labelClass}>
          Price a branch a month ({quote.currency})
          <input
            name="price"
            type="number"
            required
            min={0}
            step={0.01}
            defaultValue={quote.perBranch}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          How often they pay
          <select name="term" defaultValue={quote.term} className={inputClass}>
            {Object.entries(TERMS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Starts on
          <input name="startsOn" type="date" required defaultValue={today()} className={inputClass} />
        </label>
        <label className={labelClass}>
          Ends on (optional)
          <input name="endsOn" type="date" className={inputClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Notes (optional)
          <input
            name="notes"
            maxLength={500}
            placeholder="What was agreed beyond the price"
            className={inputClass}
          />
        </label>
      </div>
      {error && <Notice tone="danger" title={error} />}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" busy={busy}>
          Record the deal
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Not now
        </Button>
      </div>
    </form>
  );
}

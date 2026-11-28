'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { money, tierRange, type RateCard } from '@admin/lib/enterprise';
import { Button, Card, inputClass } from './ui';

type CurrencyCard = RateCard['currencies'][number];
type Row = { key: number; fromBranches: string; price: string; floor: string };

const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));
const cell = inputClass.replace('h-11 w-full', 'h-10 w-full min-w-[6.5rem]');

/**
 * One currency's rate card (D-151): the tiers (from how many branches, the price a branch a month
 * and its floor) and the terms quotes follow. Saved as a whole; the API checks it again.
 */
export function RateCardEditor({ card }: { card: CurrencyCard }) {
  const router = useRouter();
  const { currency } = card;
  const [rows, setRows] = useState<Row[]>(() =>
    card.tiers.length
      ? card.tiers.map((t, key) => ({
          key,
          fromBranches: String(t.fromBranches),
          price: t.price,
          floor: t.floor,
        }))
      : [{ key: 0, fromBranches: '6', price: '', floor: '' }],
  );
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [clearing, setClearing] = useState(false);
  const set = (key: number, field: keyof Omit<Row, 'key'>, value: string) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, [field]: value } : x)));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const read = (name: string) => num(fieldText(form, name));
    const tiers = rows
      .map((r) => ({ fromBranches: num(r.fromBranches), price: num(r.price), floor: num(r.floor) }))
      .sort((a, b) => a.fromBranches - b.fromBranches);
    const floorAbove = tiers.find((t) => t.floor > t.price);
    if (floorAbove) {
      setSaid({ ok: false, text: `The tier from ${floorAbove.fromBranches} has its floor above its price.` });
      return;
    }
    setBusy(true);
    setSaid(null);
    const result = await post(`/api/billing/enterprise/rate-card/${currency}`, {
      tiers,
      terms: {
        costPerBranch: read('cost'),
        yearlyDiscountPercent: read('yearly'),
        twoYearDiscountPercent: read('twoYears'),
        askedDiscountPercent: read('asked'),
        askedDiscountFromBranches: read('askedFrom'),
        withholdingPercent: read('withholding'),
      },
    });
    setBusy(false);
    if (result.ok) {
      setSaid({ ok: true, text: 'Saved. New quotes use it; deals keep the price they agreed.' });
      router.refresh();
    } else setSaid({ ok: false, text: result.message });
  };

  const clear = async () => {
    setBusy(true);
    setSaid(null);
    const result = await post(`/api/billing/enterprise/rate-card/${currency}/clear`);
    setBusy(false);
    setClearing(false);
    if (result.ok) router.refresh();
    else setSaid({ ok: false, text: result.message });
  };

  const t = card.terms;
  const id = (name: string) => `rc-${currency}-${name}`;
  return (
    <Card
      title={`Rate card in ${currency === 'PKR' ? 'rupees' : currency === 'USD' ? 'dollars' : currency}`}
      description={
        card.updatedAt
          ? `Last changed ${new Date(card.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : 'Not set yet: quotes in this currency need it.'
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink">Tiers, a branch a month</legend>
          <div className="relative overflow-x-auto">
            <table className="data-table min-w-[30rem]">
              <caption className="sr-only">
                Each tier: where it starts, its price a branch a month and its floor, in {currency}
              </caption>
              <thead>
                <tr>
                  <th scope="col">From (branches)</th>
                  <th scope="col">Price</th>
                  <th scope="col">Floor</th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td>
                      <input
                        aria-label={`Tier ${i + 1}: from how many branches`}
                        type="number"
                        required
                        min={2}
                        max={100000}
                        step={1}
                        value={r.fromBranches}
                        onChange={(e) => set(r.key, 'fromBranches', e.target.value)}
                        className={cell}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Tier ${i + 1}: price a branch a month, ${currency}`}
                        type="number"
                        required
                        min={0}
                        step={0.01}
                        value={r.price}
                        onChange={(e) => set(r.key, 'price', e.target.value)}
                        className={cell}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Tier ${i + 1}: floor a branch a month, ${currency}`}
                        type="number"
                        required
                        min={0}
                        step={0.01}
                        value={r.floor}
                        onChange={(e) => set(r.key, 'floor', e.target.value)}
                        className={cell}
                      />
                    </td>
                    <td className="w-12">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rows.length === 1}
                        onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                        aria-label={`Remove tier ${i + 1}`}
                      >
                        <X aria-hidden className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={rows.length >= 12}
              onClick={() =>
                setRows((x) => [
                  ...x,
                  { key: Math.max(...x.map((y) => y.key)) + 1, fromBranches: '', price: '', floor: '' },
                ])
              }
            >
              <Plus aria-hidden className="size-4" />
              Add a tier
            </Button>
            {card.tiers.length > 0 && (
              <p className="text-xs text-ink-3">
                Now:{' '}
                {card.tiers
                  .map((x) => `${tierRange(x.fromBranches, x.toBranches)} at ${money(x.price, currency)}`)
                  .join('; ')}
              </p>
            )}
          </div>
        </fieldset>

        <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <legend className="mb-2 text-sm font-medium text-ink sm:col-span-2 xl:col-span-3">Terms</legend>
          {(
            [
              ['cost', `A branch costs BUKU a month (${currency})`, t?.costPerBranch, 0.01],
              ['yearly', 'Off for paying a year ahead (%)', t?.yearlyDiscountPercent, 0.01],
              ['twoYears', 'Off for paying two years ahead (%)', t?.twoYearDiscountPercent, 0.01],
              ['asked', 'The most off when a chain asks (%)', t?.askedDiscountPercent, 0.01],
              ['askedFrom', 'Chains may ask from (branches)', t?.askedDiscountFromBranches, 1],
              ['withholding', 'Tax the chain withholds (%)', t?.withholdingPercent, 0.01],
            ] as const
          ).map(([name, label, value, step]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <label htmlFor={id(name)} className="text-xs font-medium text-ink-2">
                {label}
              </label>
              <input
                id={id(name)}
                name={name}
                type="number"
                required
                min={name === 'askedFrom' ? 2 : 0}
                max={name === 'cost' ? 10000000 : name === 'askedFrom' ? 100000 : 100}
                step={step}
                defaultValue={value ?? ''}
                className={inputClass}
              />
            </div>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" busy={busy}>
            Save the {currency} rate card
          </Button>
          {card.tiers.length > 0 &&
            (clearing ? (
              <span
                role="group"
                aria-label={`Clear the ${currency} rate card`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-sm text-ink-2">
                  No more quotes in {currency}? Deals keep their prices.
                </span>
                <Button type="button" variant="danger" size="sm" busy={busy} onClick={() => void clear()}>
                  Clear it
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setClearing(false)}>
                  Keep it
                </Button>
              </span>
            ) : (
              <Button type="button" variant="danger-quiet" onClick={() => setClearing(true)}>
                Clear
              </Button>
            ))}
          {said && (
            <p
              role={said.ok ? 'status' : 'alert'}
              className={`text-sm ${said.ok ? 'text-ok' : 'text-danger'}`}
            >
              {said.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

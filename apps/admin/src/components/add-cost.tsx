'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { COST_CATEGORIES } from '@admin/lib/billing';
import { fieldText, post } from '@admin/lib/client';
import { Button, inputClass } from './ui';

/** Add a monthly running cost (3.6j): what it is, its kind, what it costs a month in dollars. */
export function AddCost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setSaid(null);
    const result = await post('/api/billing/costs', {
      name: fieldText(form, 'name'),
      category: fieldText(form, 'category'),
      monthlyAmount: Number(fieldText(form, 'amount')),
    });
    setBusy(false);
    if (result.ok) {
      formEl.reset();
      setSaid({ ok: true, text: 'Added.' });
      router.refresh();
    } else setSaid({ ok: false, text: result.message });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.8fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          What it is
          <input name="name" required maxLength={100} placeholder="Database servers" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Kind
          <select name="category" className={inputClass}>
            {Object.entries(COST_CATEGORIES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          USD a month
          <input
            name="amount"
            type="number"
            required
            min={0}
            max={10000000}
            step={0.01}
            className={inputClass}
          />
        </label>
        <Button type="submit" busy={busy}>
          Add
        </Button>
      </div>
      {said && (
        <p role={said.ok ? 'status' : 'alert'} className={`text-xs ${said.ok ? 'text-ok' : 'text-danger'}`}>
          {said.text}
        </p>
      )}
    </form>
  );
}

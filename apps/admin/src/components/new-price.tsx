'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { CHANNELS } from '@admin/lib/billing';
import { fieldText, post } from '@admin/lib/client';
import { Button, inputClass } from './ui';

/**
 * A new price for a plan on one channel (3.6i). It replaces the one in force there for new
 * customers; subscribers keep the price they agreed to (and in many countries must be told
 * before an increase).
 */
export function NewPrice({ code, name }: { code: string; name: string }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setSaid(null);
    const result = await post(`/api/billing/plans/${code}/prices`, {
      channel: fieldText(form, 'channel'),
      amount: Number(fieldText(form, 'amount')),
      interval: fieldText(form, 'interval'),
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setSaid({ ok: true, text: 'New price in force for new customers.' });
      router.refresh();
    } else
      setSaid({
        ok: false,
        text: result.reference ? `${result.message} (reference ${result.reference})` : result.message,
      });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen(!open)}
      >
        New price…<span className="sr-only"> ({name})</span>
      </Button>
      {open && (
        <form
          id={formId}
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-3 rounded-xl bg-sunken/60 p-4 ring-1 ring-line ring-inset"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Sold on
              <select name="channel" className={inputClass}>
                {Object.entries(CHANNELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Amount (USD)
              <input
                name="amount"
                type="number"
                required
                min={0}
                max={100000}
                step={0.01}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Every
              <select name="interval" className={inputClass}>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-ink-3">
            New customers pay this from now on. Subscribers keep the price they agreed to.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" busy={busy}>
              Set the price
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {said && (
        <p role={said.ok ? 'status' : 'alert'} className={`text-xs ${said.ok ? 'text-ok' : 'text-danger'}`}>
          {said.text}
        </p>
      )}
    </div>
  );
}

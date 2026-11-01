'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CHANNELS, type Fee } from '@admin/lib/billing';
import { fieldText, post } from '@admin/lib/client';
import { Button, inputClass } from './ui';

/** What one channel keeps of each payment (3.6j): a percentage plus a fixed amount. */
export function FeeForm({ fee }: { fee: Fee }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const label = CHANNELS[fee.channel];
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setSaid(null);
    const result = await post(`/api/billing/fees/${fee.channel}`, {
      percent: Number(fieldText(form, 'percent')),
      fixedAmount: Number(fieldText(form, 'fixed')),
    });
    setBusy(false);
    if (result.ok) {
      setSaid({ ok: true, text: 'Saved.' });
      router.refresh();
    } else setSaid({ ok: false, text: result.message });
  };
  return (
    <form
      aria-label={`${label} fee`}
      onSubmit={(e) => void submit(e)}
      className="grid gap-3 rounded-xl bg-sunken/60 p-3.5 ring-1 ring-line ring-inset sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end"
    >
      <p className="text-sm font-medium text-ink sm:pb-2.5">{label}</p>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        Percent
        <input
          name="percent"
          type="number"
          min={0}
          max={100}
          step={0.01}
          defaultValue={fee.percent}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
        Plus ({fee.currency})
        <input
          name="fixed"
          type="number"
          min={0}
          step={0.01}
          defaultValue={fee.fixedAmount}
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" busy={busy}>
          Save<span className="sr-only"> ({label})</span>
        </Button>
        {said && (
          <span
            role={said.ok ? 'status' : 'alert'}
            className={`text-xs ${said.ok ? 'text-ok' : 'text-danger'}`}
          >
            {said.text}
          </span>
        )}
      </div>
    </form>
  );
}

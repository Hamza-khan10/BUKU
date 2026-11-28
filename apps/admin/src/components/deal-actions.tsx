'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { TERMS, type Deal } from '@admin/lib/enterprise';
import { Button, inputClass } from './ui';

const labelClass = 'flex flex-col gap-1 text-xs font-medium text-ink-2';

/**
 * A live deal's actions (D-151): change it (a new price a branch after quoting again, how often
 * they pay, when it ends), or end it, asked twice. The branches it bills follow the chain anyway.
 */
export function DealActions({ deal }: { deal: Deal }) {
  const router = useRouter();
  const [open, setOpen] = useState<'change' | 'end' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = async (path: `/api/${string}`, body?: unknown) => {
    setBusy(true);
    setError(null);
    const result = await post(path, body);
    setBusy(false);
    if (result.ok) {
      setOpen(null);
      router.refresh();
    } else setError(result.message);
  };
  const change = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const endsOn = fieldText(form, 'endsOn');
    void done(`/api/billing/enterprise/deals/${deal.id}`, {
      pricePerBranch: Number(fieldText(form, 'price')),
      term: fieldText(form, 'term'),
      endsOn: endsOn || null,
    });
  };

  if (open === 'change') {
    return (
      <form
        onSubmit={change}
        aria-label={`Change the deal with ${deal.name}`}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            A branch a month ({deal.currency})
            <input
              name="price"
              type="number"
              required
              min={0}
              step={0.01}
              defaultValue={deal.pricePerBranch}
              className={inputClass.replace('h-11 w-full', 'h-9 w-32')}
            />
          </label>
          <label className={labelClass}>
            How often
            <select
              name="term"
              defaultValue={deal.term}
              className={inputClass.replace('h-11 w-full', 'h-9 w-40')}
            >
              {Object.entries(TERMS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Ends on
            <input
              name="endsOn"
              type="date"
              defaultValue={deal.endsOn ?? ''}
              className={inputClass.replace('h-11 w-full', 'h-9 w-40')}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" busy={busy}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>
            Not now
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </form>
    );
  }
  if (open === 'end') {
    return (
      <div role="group" aria-label={`End the deal with ${deal.name}`} className="flex flex-col gap-2">
        <p className="text-xs text-ink-2">End it? It leaves the month’s revenue and stays on record.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="danger"
            busy={busy}
            onClick={() => void done(`/api/billing/enterprise/deals/${deal.id}/end`)}
          >
            End the deal
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
            Keep it
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setOpen('change')}>
        Change
        <span className="sr-only"> the deal with {deal.name}</span>
      </Button>
      <Button size="sm" variant="danger-quiet" onClick={() => setOpen('end')}>
        End
        <span className="sr-only"> the deal with {deal.name}</span>
      </Button>
    </div>
  );
}

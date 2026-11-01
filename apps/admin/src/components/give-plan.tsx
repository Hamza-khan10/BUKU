'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { Button, Field, inputClass, Notice } from './ui';

/**
 * Give a business a plan free of charge (3.6h): a launch partner, an apology, a pilot. By the
 * business's ID (it's on Businesses); for good or until a date; why, for the record.
 */
export function GivePlan({ plans }: { plans: { code: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setSaid(null);
    const until = fieldText(form, 'until');
    const result = await post('/api/billing/grants', {
      businessId: fieldText(form, 'business'),
      planCode: fieldText(form, 'plan'),
      reason: fieldText(form, 'reason'),
      ...(until && { until }),
      ...(form.get('replace') === 'on' && { replace: true }),
    });
    setBusy(false);
    if (result.ok) {
      formEl.reset();
      setSaid({ ok: true, text: 'Given. It shows in the list below.' });
      router.refresh();
    } else
      setSaid({
        ok: false,
        text: result.reference ? `${result.message} (reference ${result.reference})` : result.message,
      });
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business ID" hint="12 letters and digits, from Businesses.">
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              name="business"
              required
              pattern="[0-9A-Za-z]{12}"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>
        <Field label="Plan">
          {({ id }) => (
            <select id={id} name="plan" required className={inputClass}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Free until" hint="Leave empty: for good.">
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              name="until"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Why" hint="Kept with the plan and in the audit log.">
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              name="reason"
              required
              minLength={3}
              maxLength={300}
              className={inputClass}
            />
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="replace" className="size-4 accent-[var(--brand)]" />
        Replace a plan we gave them or their trial (never a plan they pay for)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy}>
          Give the plan
        </Button>
        {said && (
          <span className="min-w-0 flex-1">
            <Notice tone={said.ok ? 'ok' : 'danger'} title={said.text} />
          </span>
        )}
      </div>
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { Button, inputClass } from './ui';

/**
 * Approve a plan request (3.6h): the plan they asked for, or another; free for good or until a
 * date; a note for the record. Opens in place; the API's answer is said right there.
 */
export function ApproveRequest({
  id,
  subject,
  asked,
  plans,
}: {
  id: string;
  subject: string;
  asked: string;
  plans: { code: string; name: string }[];
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const planCode = fieldText(form, 'plan');
    const until = fieldText(form, 'until');
    const note = fieldText(form, 'note');
    setBusy(true);
    setSaid(null);
    const result = await post(`/api/billing/requests/${id}/approve`, {
      ...(planCode && planCode !== asked && { planCode }),
      ...(until && { until }),
      ...(note && { note }),
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setSaid({ ok: true, text: 'Approved: the plan is theirs.' });
      router.refresh();
    } else
      setSaid({
        ok: false,
        text: result.reference ? `${result.message} (reference ${result.reference})` : result.message,
      });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button size="sm" aria-expanded={open} aria-controls={formId} onClick={() => setOpen(!open)}>
        Approve…<span className="sr-only"> ({subject})</span>
      </Button>
      {open && (
        <form
          id={formId}
          onSubmit={(e) => void submit(e)}
          className="flex w-full max-w-sm flex-col gap-3 text-left"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Plan to give
            <select name="plan" defaultValue={asked} className={inputClass}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Free until (leave empty: for good)
            <input
              name="until"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Note for the record (optional)
            <input name="note" maxLength={500} className={inputClass} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" busy={busy}>
              Approve
            </Button>
          </div>
        </form>
      )}
      {said && (
        <p
          role={said.ok ? 'status' : 'alert'}
          className={`text-right text-xs ${said.ok ? 'text-ok' : 'text-danger'}`}
        >
          {said.text}
        </p>
      )}
    </div>
  );
}

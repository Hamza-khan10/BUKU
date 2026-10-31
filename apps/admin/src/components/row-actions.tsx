'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { post } from '@admin/lib/client';
import { Button } from './ui';

export interface RowAction {
  /** This app's endpoint for it. */
  path: `/api/${string}`;
  label: string;
  tone?: 'primary' | 'secondary' | 'danger' | 'danger-quiet';
  /** Asks for a reason first (the owner is told it); the question shown. */
  reason?: string;
  /** Sent as the body, besides any reason. */
  body?: Record<string, unknown>;
}

/**
 * The steps an operator can take on one row (a business, a report). One that needs a reason opens
 * a short form in place; the API's answer — done, or why not, word for word — is said right there,
 * and the page reloads its list.
 */
export function RowActions({ subject, actions }: { subject: string; actions: RowAction[] }) {
  const router = useRouter();
  const formId = useId();
  const [asking, setAsking] = useState<RowAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (action: RowAction, why?: string) => {
    setBusy(action.label);
    setSaid(null);
    const result = await post(action.path, { ...action.body, ...(why !== undefined && { reason: why }) });
    setBusy(null);
    if (result.ok) {
      setAsking(null);
      setReason('');
      setSaid({ ok: true, text: `${action.label}: done.` });
      router.refresh();
    } else {
      setSaid({
        ok: false,
        text: result.reference ? `${result.message} (reference ${result.reference})` : result.message,
      });
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {actions.map((a) => (
          <Button
            key={a.label}
            type="button"
            variant={a.tone ?? 'secondary'}
            className="h-8 px-3 text-xs"
            busy={busy === a.label}
            disabled={busy !== null}
            aria-expanded={a.reason ? asking === a : undefined}
            aria-controls={a.reason ? formId : undefined}
            onClick={() => (a.reason ? setAsking(asking === a ? null : a) : void run(a))}
          >
            {a.label}
            <span className="sr-only"> ({subject})</span>
          </Button>
        ))}
      </div>
      {asking && (
        <form
          id={formId}
          className="flex w-full max-w-sm flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(asking, reason.trim());
          }}
        >
          <label htmlFor={`${formId}-reason`} className="text-left text-xs font-medium text-ink-2">
            {asking.reason}
          </label>
          <textarea
            id={`${formId}-reason`}
            required
            minLength={3}
            maxLength={1000}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-line bg-sunken px-2 py-1.5 text-sm text-ink"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => setAsking(null)}
            >
              Keep it
            </Button>
            <Button
              type="submit"
              variant={asking.tone === 'danger-quiet' ? 'danger' : (asking.tone ?? 'danger')}
              className="h-8 px-3 text-xs"
              busy={busy !== null}
            >
              {asking.label}
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

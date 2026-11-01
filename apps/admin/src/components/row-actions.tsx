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
  /** The longest reason accepted (the API's own limit; 1000 unless said). */
  reasonMax?: number;
  /** Asks to be sure first, without a reason (for a step the API takes no reason for). */
  confirm?: string;
  /** Sent as the body, besides any reason. */
  body?: Record<string, unknown>;
}

/** Called with the endpoint's answer when a step is done (besides the page reloading its data). */
export type OnDone = (data: unknown) => void;

/**
 * The steps an operator can take on one row (a business, a report). One that needs a reason opens
 * a short form in place; the API's answer — done, or why not, word for word — is said right there,
 * and the page reloads its list.
 */
export function RowActions({
  subject,
  actions,
  onDone,
}: {
  subject: string;
  actions: RowAction[];
  onDone?: OnDone;
}) {
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
      onDone?.(result.data);
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
            size="sm"
            busy={busy === a.label}
            disabled={busy !== null}
            aria-expanded={a.reason || a.confirm ? asking === a : undefined}
            aria-controls={a.reason || a.confirm ? formId : undefined}
            onClick={() => (a.reason || a.confirm ? setAsking(asking === a ? null : a) : void run(a))}
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
            void run(asking, asking.reason ? reason.trim() : undefined);
          }}
        >
          {asking.reason ? (
            <>
              <label htmlFor={`${formId}-reason`} className="text-left text-xs font-medium text-ink-2">
                {asking.reason}
              </label>
              <textarea
                id={`${formId}-reason`}
                required
                minLength={3}
                maxLength={asking.reasonMax ?? 1000}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-[10px] border border-control bg-sunken px-3 py-2 text-sm text-ink focus-visible:border-focus focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--focus)_22%,transparent)] focus-visible:outline-none"
              />
            </>
          ) : (
            <p className="text-right text-xs text-ink-2">{asking.confirm}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAsking(null)}>
              Keep it
            </Button>
            <Button
              type="submit"
              variant={asking.tone === 'primary' ? 'primary' : 'danger'}
              size="sm"
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

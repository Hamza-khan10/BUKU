'use client';

import { Search } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ROLE_NAMES, type Account } from '@admin/lib/accounts';
import type { AuditEntry } from '@admin/lib/audit';
import { fieldText, post } from '@admin/lib/client';
import { RowActions, type RowAction } from './row-actions';
import { Timeline } from './timeline';
import { Button, cx, Field, Initials, inputClass, Notice, Pill } from './ui';

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

/** The steps the API allows on this account; none for platform admins or a deleted account. */
function stepsFor(a: Account): RowAction[] {
  const base = `/api/accounts/${a.id}` as const;
  if (a.role === 'super_admin' || a.status === 'deleted') return [];
  if (a.status === 'suspended') return [{ path: `${base}/reinstate`, label: 'Reinstate', tone: 'primary' }];
  return [
    {
      path: `${base}/end-sessions`,
      label: 'Sign out everywhere',
      tone: 'secondary',
      reason: 'Why sign them out everywhere? They can sign in again; recorded with your name.',
      reasonMax: 500,
    },
    {
      path: `${base}/suspend`,
      label: 'Suspend',
      tone: 'danger-quiet',
      reason: 'Why suspend this account? They’re signed out everywhere and can’t sign in until reinstated.',
      reasonMax: 500,
    },
  ];
}

/**
 * Find one person and act on their account (3.6). The search lives in this page's state only: an
 * email never goes into the address bar or the history.
 */
export function AccountsConsole() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reference?: string | undefined } | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const search = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = fieldText(new FormData(e.currentTarget), 'query');
    if (!query) return;
    setBusy(true);
    setError(null);
    const result = await post<Account>('/api/accounts/find', { query });
    setBusy(false);
    if (result.ok) setAccount(result.data);
    else {
      setAccount(null);
      setError({
        message: result.code === 'NOT_FOUND' ? 'No account has that email or ID.' : result.message,
        reference: result.code === 'NOT_FOUND' ? undefined : result.reference,
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form role="search" onSubmit={(e) => void search(e)} className="flex max-w-xl items-end gap-2">
        <div className="flex-1">
          <Field label="Email or account ID">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                name="query"
                autoComplete="off"
                spellCheck={false}
                required
                maxLength={254}
                className={inputClass}
              />
            )}
          </Field>
        </div>
        <Button type="submit" busy={busy}>
          <Search aria-hidden className="size-4" /> Find
        </Button>
      </form>

      {error && (
        <Notice tone={error.reference ? 'danger' : 'info'} title={error.message}>
          {error.reference && <span className="font-mono text-xs">Reference: {error.reference}</span>}
        </Notice>
      )}

      {account && <AccountCard account={account} onChange={setAccount} />}
    </div>
  );
}

function AccountCard({ account: a, onChange }: { account: Account; onChange: (a: Account) => void }) {
  const steps = stepsFor(a);
  return (
    <section
      aria-label={`Account: ${a.name}`}
      className={cx(
        'panel rise flex flex-col gap-5 p-5 sm:p-6',
        a.status === 'suspended' && 'border-danger/50',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <Initials name={a.name} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
              {a.name}
              {a.status === 'active' && <Pill tone="ok">Active</Pill>}
              {a.status === 'suspended' && <Pill tone="danger">Suspended</Pill>}
              {a.status === 'deleted' && <Pill>Deleted</Pill>}
              <Pill tone={a.role === 'super_admin' ? 'brand' : 'neutral'}>
                {ROLE_NAMES[a.role] ?? a.role}
              </Pill>
              {a.employeeLogin && <Pill>Employee login</Pill>}
            </h2>
            <p className="text-sm text-ink-2">
              {a.email ?? 'No email'} · <span className="font-mono">{a.id}</span>
            </p>
          </div>
        </div>
        {steps.length > 0 && (
          <RowActions subject={a.name} actions={steps} onDone={(data) => onChange(data as Account)} />
        )}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Fact term="Since">{day(a.since)}</Fact>
        <Fact term="Last sign-in">{a.lastSignIn ? day(a.lastSignIn) : 'Never'}</Fact>
        <Fact term="Signed in on">{a.sessions === 1 ? '1 device' : `${a.sessions} devices`}</Fact>
        <Fact term="Two-step sign-in">{a.twoStep ? 'On' : 'Off'}</Fact>
      </dl>

      {a.deletionRequested && (
        <Notice tone="wait" title={`Asked to delete this account on ${day(a.deletionRequested)}`}>
          It’s hidden; signing in again during the grace period restores it.
        </Notice>
      )}
      {a.role === 'super_admin' && (
        <Notice title="Platform admins can’t be suspended or signed out here">
          Remove their admin access first with <code className="font-mono">pnpm admin:role</code> (recorded,
          with a reason); then they’re an ordinary account.
        </Notice>
      )}

      <Activity account={a} />

      {a.businesses.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Businesses</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {a.businesses.map((b) => (
              <li key={`${b.id ?? b.name}-${b.role}`} className="text-ink-2">
                <span className="font-medium text-ink">{b.name}</span> · {b.role.replaceAll('_', ' ')}
                {b.status !== 'active' && <> · {b.status}</>}
                {b.id && <span className="font-mono text-xs text-ink-3"> · {b.id}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-sunken/60 px-3.5 py-3 ring-1 ring-line ring-inset">
      <dt className="text-xs text-ink-3">{term}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}

/** The person's recent steps, opened on request (opening it is recorded on your own trail). */
function Activity({ account }: { account: Account }) {
  const [state, setState] = useState<
    | { kind: 'closed' }
    | { kind: 'loading' }
    | { kind: 'shown'; entries: AuditEntry[] }
    | { kind: 'failed'; message: string }
  >({ kind: 'closed' });
  const open = async () => {
    setState({ kind: 'loading' });
    const result = await post<AuditEntry[]>(`/api/accounts/${account.id}/audit`);
    setState(
      result.ok ? { kind: 'shown', entries: result.data } : { kind: 'failed', message: result.message },
    );
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Recent activity</h3>
        {state.kind !== 'shown' && (
          <Button variant="secondary" size="sm" busy={state.kind === 'loading'} onClick={() => void open()}>
            Show their activity
          </Button>
        )}
      </div>
      {state.kind === 'closed' && (
        <p className="text-xs text-ink-3">
          Their last 50 steps and what was done to their account. Opening it is recorded.
        </p>
      )}
      {state.kind === 'failed' && <Notice tone="danger" title={state.message} />}
      {state.kind === 'shown' &&
        (state.entries.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing recorded yet.</p>
        ) : (
          <Timeline entries={state.entries} />
        ))}
    </div>
  );
}

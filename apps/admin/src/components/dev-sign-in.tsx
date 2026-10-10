'use client';

import { useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { Button, Field, inputClass, Notice } from './ui';

/** Development sign-in: an email becomes a platform admin's account (never on the live site). */
export function DevSignIn() {
  const [error, setError] = useState<{ message: string; reference?: string | undefined } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const result = await post<{ next: string }>('/api/auth/dev', {
      email: fieldText(form, 'email'),
      name: fieldText(form, 'name') || undefined,
    });
    if (result.ok) {
      window.location.assign(result.data.next);
      return;
    }
    setBusy(false);
    setError({ message: result.message, reference: result.reference });
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {error && (
        <Notice tone="danger" title={error.message}>
          {error.reference && <span className="font-mono text-xs">Reference: {error.reference}</span>}
        </Notice>
      )}
      <Field label="Email">
        {({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            name="email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            required
            maxLength={254}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="Name" hint="Only for a new account.">
        {({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            name="name"
            autoComplete="name"
            maxLength={100}
            className={inputClass}
          />
        )}
      </Field>
      <Button type="submit" busy={busy}>
        Sign in
      </Button>
    </form>
  );
}

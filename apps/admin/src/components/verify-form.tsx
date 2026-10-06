'use client';

import { useState, type FormEvent } from 'react';
import { fieldText, post } from '@admin/lib/client';
import { Button, Field, inputClass, Notice } from './ui';

/** The second step: a code from the authenticator app, or a recovery code. */
export function VerifyForm() {
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = fieldText(new FormData(e.currentTarget), 'value');
    setBusy(true);
    setError(null);
    const result = await post<{ next: string }>(
      '/api/auth/verify',
      mode === 'code' ? { code: value.replace(/\D/g, '') } : { recoveryCode: value.toUpperCase() },
    );
    if (result.ok) {
      window.location.assign(result.data.next);
      return;
    }
    setBusy(false);
    if (result.code === 'SIGN_IN_EXPIRED') window.location.assign('/signin?error=expired');
    else
      setError(
        result.code === 'MFA_INVALID_CODE'
          ? 'That code isn’t right. Enter the one showing now.'
          : result.message,
      );
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {error && <Notice tone="danger" title={error} />}
      <Field
        label={mode === 'code' ? '6-digit code' : 'Recovery code'}
        hint={
          mode === 'code'
            ? 'From your authenticator app.'
            : 'One you saved when you turned on two-step sign-in.'
        }
      >
        {({ id, describedBy }) => (
          <input
            key={mode}
            id={id}
            aria-describedby={describedBy}
            name="value"
            inputMode={mode === 'code' ? 'numeric' : 'text'}
            autoComplete={mode === 'code' ? 'one-time-code' : 'off'}
            spellCheck={false}
            autoFocus
            maxLength={mode === 'code' ? 12 : 20}
            className={`${inputClass} font-mono tracking-widest`}
          />
        )}
      </Field>
      <Button type="submit" busy={busy}>
        Continue
      </Button>
      <button
        type="button"
        onClick={() => setMode(mode === 'code' ? 'recovery' : 'code')}
        className="w-fit text-sm font-medium text-brand underline-offset-4 hover:underline"
      >
        {mode === 'code' ? 'Use a recovery code instead' : 'Use the code from your app instead'}
      </button>
    </form>
  );
}

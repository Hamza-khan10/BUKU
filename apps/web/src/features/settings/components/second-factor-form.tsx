'use client';

import { useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { codeDigits, looksLikeRecoveryCode, recoveryChars } from '@/features/auth/codes';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import type { SecondFactor } from '../api';

/**
 * Proving it's you with two-step sign-in: the code from the app (sent as soon
 * as six digits are in), or — for a lost phone — one of the recovery codes.
 * `onProof` does the work; a wrong code is said next to the field.
 */
export function SecondFactorForm({
  action,
  danger,
  onProof,
  children,
}: {
  /** The button: "Turn off", "Get new codes". */
  action: string;
  danger?: boolean;
  onProof: (proof: SecondFactor) => Promise<void>;
  /** Shown between the field and the button (e.g. a Cancel). */
  children?: ReactNode;
}) {
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async (proof: SecondFactor) => {
    setBusy(true);
    setFieldError(undefined);
    setProblem(undefined);
    try {
      await onProof(proof);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_INVALID_CODE') {
        setFieldError(
          mode === 'code'
            ? 'That code isn’t right. Codes change every 30 seconds: enter the one showing now.'
            : 'That recovery code isn’t right, or it was already used.',
        );
        setCode('');
        setRecovery('');
        input.current?.focus();
      } else {
        setProblem(problemFrom(err, 'That didn’t work. Please try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (to: 'code' | 'recovery', value = '') => {
    setMode(to);
    setCode(to === 'code' ? value : '');
    setRecovery(to === 'recovery' ? value : '');
    setFieldError(undefined);
    requestAnimationFrame(() => input.current?.focus());
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'code') {
      if (code.length === 6) void send({ code });
      else setFieldError('Enter the 6 digits from your authenticator app.');
      return;
    }
    const chars = recoveryChars(recovery);
    if (chars.length === 8) void send({ recoveryCode: `${chars.slice(0, 4)}-${chars.slice(4)}` });
    else setFieldError('Recovery codes have 8 letters and digits, like K7QX-2M9P.');
  };

  const typeCode = (value: string) => {
    const digits = codeDigits(value);
    setCode(digits);
    setFieldError(undefined);
    if (digits.length === 6 && !busy) void send({ code: digits });
  };

  const pasteIntoCode = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (looksLikeRecoveryCode(text)) {
      e.preventDefault();
      switchTo('recovery', text.trim().toUpperCase());
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <ProblemAlert problem={problem} />
      {mode === 'code' ? (
        <Field
          label="6-digit code"
          required
          optionalLabel={false}
          hint="From your authenticator app."
          error={fieldError}
        >
          <Input
            ref={input}
            name="code"
            value={code}
            onChange={(e) => typeCode(e.target.value)}
            onPaste={pasteIntoCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={12}
            readOnly={busy}
            className="h-13 text-center font-mono text-xl tracking-[0.4em]"
          />
        </Field>
      ) : (
        <Field
          label="Recovery code"
          required
          optionalLabel={false}
          hint="One you saved when you turned on two-step sign-in. It works once."
          error={fieldError}
        >
          <Input
            ref={input}
            name="recovery-code"
            value={recovery}
            onChange={(e) => {
              setRecovery(e.target.value.toUpperCase());
              setFieldError(undefined);
            }}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            maxLength={20}
            readOnly={busy}
            placeholder="XXXX-XXXX"
            className="h-13 text-center font-mono text-lg tracking-widest"
          />
        </Field>
      )}
      <Button
        type="button"
        variant="link"
        className="w-fit"
        onClick={() => switchTo(mode === 'code' ? 'recovery' : 'code')}
        disabled={busy}
      >
        {mode === 'code' ? 'Lost your phone? Use a recovery code' : 'Use the code from your app instead'}
      </Button>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {children}
        <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy}>
          {action}
        </Button>
      </div>
    </form>
  );
}

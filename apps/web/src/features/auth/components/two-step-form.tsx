'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api/errors';
import { fetchTwoStepStatus, verifySignIn } from '../api';
import { codeDigits, looksLikeRecoveryCode, recoveryChars } from '../codes';
import { newPasswordHref, signInHref, type SignInStart } from '../paths';
import { problemFrom, type Problem } from '../problems';
import { COOKIES_BLOCKED, useFinishSignIn } from '../use-finish-sign-in';
import { ProblemAlert } from './problem-alert';

type Mode = 'code' | 'recovery';

/**
 * The second step of signing in: the 6-digit code from the authenticator app
 * (sent as soon as six digits are in), or one of the recovery codes. Wrong
 * codes count towards a lock; the challenge lasts a few minutes, then this
 * sign-in starts again.
 */
export function TwoStepForm({
  next,
  start,
  expiresAt,
}: {
  next: string;
  start: SignInStart;
  /** When the challenge lapses; the form then offers to start again. */
  expiresAt: string;
}) {
  const router = useRouter();
  const finish = useFinishSignIn();
  const [mode, setMode] = useState<Mode>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (expired) {
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="wait" title="This sign-in has expired">
          For your safety, the code step only stays open for a few minutes. Start again — it only takes a
          moment.
        </Alert>
        <Button asChild variant="primary" size="lg" block>
          <Link href={signInHref(start, next) as Route}>Sign in again</Link>
        </Button>
      </div>
    );
  }

  const switchTo = (to: Mode, value = '') => {
    setMode(to);
    setCode(to === 'code' ? value : '');
    setRecovery(to === 'recovery' ? value : '');
    setFieldError(undefined);
    setProblem(undefined);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const send = async (input: { code: string } | { recoveryCode: string }) => {
    setBusy(true);
    setFieldError(undefined);
    setProblem(undefined);
    try {
      const answer = await verifySignIn(input);
      if ('recoveryCode' in input) {
        void fetchTwoStepStatus()
          .then(({ recoveryCodesLeft: left }) =>
            toast(
              left === 0
                ? 'That was your last recovery code.'
                : `You used a recovery code. ${left} ${left === 1 ? 'is' : 'are'} left.`,
            ),
          )
          .catch(() => undefined);
      }
      const outcome = finish(answer, { next, start });
      if (outcome === 'new-password') router.replace(newPasswordHref(next) as Route);
      if (outcome === 'no-cookies') setProblem({ title: COOKIES_BLOCKED });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'SIGN_IN_EXPIRED') {
        setExpired(true);
        return;
      }
      if (err instanceof ApiError && err.code === 'MFA_INVALID_CODE') {
        setFieldError(
          mode === 'code'
            ? 'That code isn’t right. Codes change every 30 seconds — enter the one showing now.'
            : 'That recovery code isn’t right, or it was already used.',
        );
        setCode('');
        setRecovery('');
        inputRef.current?.focus();
        return;
      }
      setProblem(problemFrom(err, 'Checking the code didn’t work. Please try again.'));
      return;
    }
    // Stays busy while the next page loads.
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'code') {
      if (code.length !== 6) {
        setFieldError('Enter the 6 digits from your authenticator app.');
        return;
      }
      void send({ code });
    } else {
      const chars = recoveryChars(recovery);
      if (chars.length !== 8) {
        setFieldError('Recovery codes have 8 letters and digits, like K7QX-2M9P.');
        return;
      }
      void send({ recoveryCode: `${chars.slice(0, 4)}-${chars.slice(4)}` });
    }
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
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <ProblemAlert problem={problem} />
      {mode === 'code' ? (
        <Field
          label="6-digit code"
          required
          optionalLabel={false}
          hint="Open your authenticator app and enter the code it shows for BUKU."
          error={fieldError}
        >
          <Input
            ref={inputRef}
            name="code"
            value={code}
            onChange={(e) => typeCode(e.target.value)}
            onPaste={pasteIntoCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={12}
            readOnly={busy}
            className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
          />
        </Field>
      ) : (
        <Field
          label="Recovery code"
          required
          optionalLabel={false}
          hint="One of the codes you saved when you turned on two-step sign-in. Each works once."
          error={fieldError}
        >
          <Input
            ref={inputRef}
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
            className="h-14 text-center font-mono text-xl tracking-widest"
          />
        </Field>
      )}

      <Button type="submit" variant="primary" size="lg" loading={busy} block>
        Continue
      </Button>

      <div className="flex flex-col items-center gap-2 text-sm text-ink-2">
        <Button
          type="button"
          variant="link"
          onClick={() => switchTo(mode === 'code' ? 'recovery' : 'code')}
          disabled={busy}
        >
          {mode === 'code' ? 'Use a recovery code instead' : 'Use the code from your app instead'}
        </Button>
        <p className="text-center text-ink-3">
          For your safety, this step only stays open for a few minutes.
        </p>
      </div>
    </form>
  );
}

'use client';

import { PASSWORD_MIN_LENGTH, PASSWORD_PROBLEM_MESSAGES, passwordProblem } from '@buku/validation';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { toast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api/errors';
import { businessSignIn, changePassword, ME_KEY } from '../api';
import { signInHref } from '../paths';
import { problemFrom, type Problem } from '../problems';
import { COOKIES_BLOCKED, useFinishSignIn } from '../use-finish-sign-in';
import { ProblemAlert } from './problem-alert';

interface Errors {
  current?: string | undefined;
  password?: string | undefined;
  again?: string | undefined;
  form?: Problem | undefined;
}

const sentence = (message: string) => (/[.!?]$/.test(message) ? message : `${message}.`);

/**
 * Replacing the temporary password a business gave its employee. Until this
 * is done the account has no access to the business (the API's rule). The
 * password just typed to sign in is reused when we have it (`current`), and
 * afterwards the employee is signed straight back in with the new one.
 */
export function NewPasswordForm({
  username,
  business,
  current,
  next,
}: {
  username: string;
  /** The business's handle, to sign back in afterwards (unknown: they sign in themselves). */
  business: string | null;
  /** The temporary password, when it was just typed on the sign-in form. */
  current?: string | undefined;
  next: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const finish = useFinishSignIn();
  const [temporary, setTemporary] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  /** On to the sign-in form, filled in, to sign in with the new password there. */
  const signInYourself = () => {
    toast.success('Your password is set. Sign in with it now.');
    router.replace(signInHref('business', next, { business: business ?? undefined, username }) as Route);
    router.refresh();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const currentPassword = current ?? temporary;
    const problem = passwordProblem(password, { username, current: currentPassword || undefined });
    const found: Errors = {
      current: currentPassword ? undefined : 'Enter the temporary password your business gave you.',
      password: problem ? PASSWORD_PROBLEM_MESSAGES[problem] : undefined,
      again: !problem && password !== again ? 'The two passwords don’t match.' : undefined,
    };
    setErrors(found);
    if (found.current || found.password || found.again) return;

    setBusy(true);
    try {
      await changePassword({ currentPassword, newPassword: password });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' && !current) {
        setErrors({ current: 'That isn’t the temporary password. Check it with your business.' });
      } else if (
        err instanceof ApiError &&
        (err.code === 'PASSWORD_TOO_WEAK' || err.code === 'PASSWORD_BREACHED')
      ) {
        setErrors({ password: sentence(err.message) });
      } else {
        setErrors({ form: problemFrom(err, 'Your password couldn’t be changed. Please try again.') });
      }
      return;
    }

    // Every session of the account ended, this one included: sign in again with the new password.
    queryClient.removeQueries({ queryKey: ME_KEY });
    if (!business) {
      signInYourself();
      return;
    }
    try {
      const answer = await businessSignIn({ business, username, password });
      const outcome = finish(answer, {
        next,
        start: 'business',
        welcome: (first) => `Your password is set. Welcome, ${first}`,
      });
      if (outcome === 'no-cookies') setErrors({ form: { title: COOKIES_BLOCKED } });
      if (outcome === 'new-password') signInYourself();
    } catch {
      signInYourself();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-xl font-semibold text-ink">Choose your own password</h2>
        <p className="text-sm text-ink-2">
          The password your business gave you is temporary. Choose one that only you know — then you’re in.
        </p>
      </div>
      <ProblemAlert problem={errors.form} />
      {/* Lets password managers save the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      {!current && (
        <Field label="Temporary password" required error={errors.current}>
          <PasswordInput
            name="current-password"
            value={temporary}
            onChange={(e) => setTemporary(e.target.value)}
            autoComplete="current-password"
            autoFocus
            maxLength={256}
          />
        </Field>
      )}
      <Field
        label="New password"
        required
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words together are easy to remember and hard to guess.`}
        error={errors.password}
      >
        <PasswordInput
          name="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus={Boolean(current)}
          maxLength={128}
        />
      </Field>
      <Field label="New password again" required error={errors.again}>
        <PasswordInput
          name="new-password-again"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          maxLength={128}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={busy} block>
        Save and continue
      </Button>
    </form>
  );
}

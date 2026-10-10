'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { ApiError } from '@/lib/api/errors';
import { businessSignIn } from '../api';
import { businessHandleFrom, usernameFrom } from '../handles';
import { problemFrom, type Problem } from '../problems';
import { COOKIES_BLOCKED, useFinishSignIn } from '../use-finish-sign-in';
import { NewPasswordForm } from './new-password-form';
import { ProblemAlert } from './problem-alert';

interface Errors {
  business?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  form?: Problem | undefined;
}

const MESSAGES = {
  business: 'Enter your business’s handle: the end of its BUKU link, like salt-and-pepper.',
  username: 'Usernames are 3 to 40 letters, digits, dots, dashes or underscores.',
  password: 'Enter your password.',
};

/**
 * Employee sign-in (D-034): the business's handle, a username and a password,
 * all given by the business. A temporary password is replaced right here,
 * before anything else — without typing it again.
 */
export function BusinessSignInForm({
  next,
  initialBusiness,
  initialUsername,
}: {
  next: string;
  initialBusiness?: string | undefined;
  initialUsername?: string | undefined;
}) {
  const finish = useFinishSignIn();
  const [business, setBusiness] = useState(initialBusiness ?? '');
  const [username, setUsername] = useState(initialUsername ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState<{ business: string; username: string; password: string } | null>(
    null,
  );
  const passwordRef = useRef<HTMLInputElement>(null);

  if (temporary) {
    return (
      <NewPasswordForm
        business={temporary.business}
        username={temporary.username}
        current={temporary.password}
        next={next}
      />
    );
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const handle = businessHandleFrom(business);
    const user = usernameFrom(username);
    const found: Errors = {
      business: handle ? undefined : MESSAGES.business,
      username: user ? undefined : MESSAGES.username,
      password: password ? undefined : MESSAGES.password,
    };
    setErrors(found);
    if (!handle || !user || !password) return;
    // Show what will be used: a pasted link becomes the handle itself.
    setBusiness(handle);
    setUsername(user);

    setBusy(true);
    try {
      const answer = await businessSignIn({ business: handle, username: user, password });
      const outcome = finish(answer, { next, start: 'business' });
      if (outcome === 'new-password') setTemporary({ business: handle, username: user, password });
      if (outcome === 'no-cookies') setErrors({ form: { title: COOKIES_BLOCKED } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && err.fieldIssues.length > 0) {
        const byField = Object.fromEntries(err.fieldIssues.map((i) => [i.path, i.message]));
        setErrors({
          business: byField.business && MESSAGES.business,
          username: byField.username && MESSAGES.username,
          password: byField.password && MESSAGES.password,
        });
        return;
      }
      const problem = problemFrom(err, 'Signing in didn’t work. Please try again.');
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        problem.detail =
          'Check all three. Several wrong passwords in a row lock the account for a while; the business owner can reset your password.';
        setPassword('');
        passwordRef.current?.focus();
      }
      setErrors({ form: problem });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      <ProblemAlert problem={errors.form} />
      <Field
        label="Business"
        required
        hint="Its handle: the end of its BUKU link. You can paste the whole link."
        error={errors.business}
      >
        <Input
          name="business"
          value={business}
          onChange={(e) => setBusiness(e.target.value)}
          onBlur={() => setBusiness((v) => businessHandleFrom(v) ?? v)}
          placeholder="salt-and-pepper"
          autoComplete="organization"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={!initialBusiness}
          maxLength={500}
        />
      </Field>
      <Field label="Username" required error={errors.username}>
        <Input
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={Boolean(initialBusiness) && !initialUsername}
          maxLength={40}
        />
      </Field>
      <Field label="Password" required error={errors.password}>
        <PasswordInput
          ref={passwordRef}
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus={Boolean(initialBusiness && initialUsername)}
          maxLength={256}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={busy} block>
        Sign in
      </Button>
    </form>
  );
}

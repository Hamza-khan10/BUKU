'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CleanTextarea } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { fetchMe, ME_KEY } from '@/features/auth/api';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { signInHref } from '@/features/auth/paths';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { signOut } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { zText } from '@buku/validation';
import { deleteAccount } from '../api';
import { CONFIRM_WORD, confirmed, DELETION_GRACE_DAYS, goodbyeHref } from '../my-data';
import { DownloadMyData } from './data-section';

const REASON = zText({ kind: 'text', max: 500 });
const HERE = '/account/settings/delete';

/**
 * Deleting the account, said plainly first: what happens at once, what can
 * still be undone (for 30 days) and what can't, and a copy of the data to
 * take. Then a reason if they want to give one, and the word typed to be
 * sure. The API asks for a recent sign-in, so a session left open on a
 * shared computer can't do this.
 */
export function DeleteAccount() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; typed?: string }>({});
  const [problem, setProblem] = useState<Problem | undefined>();
  const [reauth, setReauth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.isPending) return <Skeleton className="h-96 max-w-2xl" />;
  if (me.isError) {
    const e = me.error instanceof ApiError ? me.error : null;
    return (
      <ErrorState
        title="We couldn’t load your account"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }
  if (me.data.account.type === 'employee') {
    return (
      <Alert title="Your business closes this account">
        It was made by your business, so they close it — for example when you leave the team.
      </Alert>
    );
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const words = reason.trim();
    const parsed = words ? REASON.safeParse(words) : null;
    const found = {
      reason: parsed && !parsed.success ? parsed.error.issues[0]?.message : undefined,
      typed: confirmed(typed) ? undefined : `Type ${CONFIRM_WORD} to confirm.`,
    };
    setErrors(found);
    if (found.reason || found.typed) return;

    setBusy(true);
    setProblem(undefined);
    try {
      const { purgeAfter } = await deleteAccount(parsed?.success ? parsed.data : undefined);
      // Signed out already (the web server cleared this browser's session): start clean.
      queryClient.clear();
      window.location.assign(goodbyeHref(purgeAfter));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        const within = (err.details as { withinMinutes?: unknown } | undefined)?.withinMinutes;
        setReauth(typeof within === 'number' ? within : 10);
        return;
      }
      const issue = err instanceof ApiError ? err.fieldIssues.find((i) => i.path === 'reason') : undefined;
      if (issue) setErrors({ reason: issue.message });
      else setProblem(problemFrom(err, 'Your account couldn’t be deleted just now. Please try again.'));
    }
  };

  const signInAgain = async () => {
    await signOut();
    window.location.assign(signInHref('signin', HERE));
  };

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section aria-label="What happens" className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold">What happens</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
          <li>You’re signed out on every device straight away.</li>
          <li>
            Visits still to come are cancelled, and the businesses are told. If you’re waiting in a queue, you
            leave it.
          </li>
          <li>
            For {DELETION_GRACE_DAYS} days you can change your mind: sign in again and choose to restore your
            account. Cancelled visits stay cancelled.
          </li>
          <li>
            After that it’s for good. Your name, email, picture, settings, saved places and messages are
            removed, and your reviews keep their stars but lose their words. Businesses keep their record of
            past visits, without your name on it.
          </li>
        </ul>
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
          <p className="text-sm text-ink-2">Want a copy of your data first?</p>
          <DownloadMyData />
        </div>
      </section>

      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        {reauth !== null && (
          <Alert tone="wait" title="For your safety, sign in again first">
            <p>
              Deleting needs a sign-in from the last {reauth} minutes, so nobody can do it from a computer you
              left signed in. You’ll come straight back here.
            </p>
            <Button variant="secondary" className="mt-3" onClick={() => void signInAgain()}>
              Sign in again
            </Button>
          </Alert>
        )}
        <ProblemAlert problem={problem} />
        <Field
          label="Why are you leaving?"
          hint="If you’d like to say. It helps us make BUKU better; businesses never see it."
          error={errors.reason}
        >
          <CleanTextarea
            kind="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </Field>
        <Field label={`Type ${CONFIRM_WORD} to confirm`} required optionalLabel={false} error={errors.typed}>
          <Input
            name="confirm"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setErrors((v) => ({ ...v, typed: undefined }));
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="max-w-64 font-mono tracking-widest"
          />
        </Field>
        <Button type="submit" variant="danger" size="lg" loading={busy} className="w-fit">
          Delete my account
        </Button>
      </form>
    </div>
  );
}

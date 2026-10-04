'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api/errors';
import {
  fetchPrefs,
  PREFS_KEY,
  updatePrefs,
  type NotificationPrefs,
  type PrefsChange,
} from '@/features/notifications/api';
import { fetchMe, ME_KEY, updateProfile, type Me } from '../api';
import { problemFrom, type Problem } from '../problems';
import { ProblemAlert } from './problem-alert';

const NAME = zText({ kind: 'personName', min: 1, max: 100 });

/** This device's time zone ("Asia/Karachi"); null while rendering on the server. */
const noChange = () => () => undefined;
function useDeviceTimeZone(): string | null {
  return useSyncExternalStore(
    noChange,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );
}

/**
 * The first visit after creating an account: the name businesses will see,
 * and which emails to get. Everything is already set to sensible defaults,
 * so "Skip for now" is a real choice, not a trap. Only asks about what BUKU
 * actually sends today.
 */
export function WelcomeForm({ next }: { next: string }) {
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });
  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: fetchPrefs });

  if (me.error || prefs.error) {
    return (
      <div className="flex flex-col gap-5">
        <ProblemAlert problem={problemFrom(me.error ?? prefs.error, 'We couldn’t load your account.')} />
        <Button asChild variant="primary" size="lg" block>
          <Link href={next as Route}>Continue</Link>
        </Button>
      </div>
    );
  }
  if (!me.data || !prefs.data) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-11" />
        <Skeleton className="h-20" />
        <Skeleton className="h-13" />
      </div>
    );
  }
  return <WelcomeFields me={me.data} prefs={prefs.data} next={next} />;
}

function WelcomeFields({ me, prefs, next }: { me: Me; prefs: NotificationPrefs; next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const timeZone = useDeviceTimeZone();
  const [name, setName] = useState(me.name);
  const [confirmations, setConfirmations] = useState(prefs.emailBookingConfirmation);
  const [reminders, setReminders] = useState(prefs.emailReminders);
  const [nameError, setNameError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = NAME.safeParse(name);
    if (!name.trim() || !parsed.success) {
      setNameError(
        (name.trim() && parsed.error?.issues[0]?.message) || 'Please enter the name businesses should see.',
      );
      return;
    }
    setNameError(undefined);
    setProblem(undefined);

    const profile: { name?: string; timezone?: string } = {
      ...(parsed.data !== me.name && { name: parsed.data }),
      ...(timeZone && timeZone !== me.timezone && { timezone: timeZone }),
    };
    const emails: PrefsChange = {
      ...(confirmations !== prefs.emailBookingConfirmation && { emailBookingConfirmation: confirmations }),
      ...(reminders !== prefs.emailReminders && { emailReminders: reminders }),
    };

    setBusy(true);
    try {
      if (Object.keys(profile).length > 0) queryClient.setQueryData(ME_KEY, await updateProfile(profile));
      if (Object.keys(emails).length > 0) queryClient.setQueryData(PREFS_KEY, await updatePrefs(emails));
    } catch (err) {
      setBusy(false);
      const issue = err instanceof ApiError ? err.fieldIssues.find((i) => i.path === 'name') : undefined;
      if (issue) setNameError(issue.message);
      else setProblem(problemFrom(err, 'Your choices couldn’t be saved. Please try again.'));
      return;
    }
    toast.success('You’re all set');
    router.replace(next as Route);
    router.refresh();
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
      <ProblemAlert problem={problem} />
      <Field
        label="Your name"
        required
        optionalLabel={false}
        hint="Businesses see it on your bookings. Reviews show only your first name and initial."
        error={nameError}
      >
        <CleanTextInput
          kind="personName"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={100}
        />
      </Field>

      {me.email && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-ink">Emails about your visits</legend>
          <p className="mb-2 text-sm text-ink-3">
            Sent to <span className="font-medium text-ink-2">{me.email}</span>.
          </p>
          <Checkbox
            label="Booking updates"
            description="When a booking is confirmed, declined, moved or cancelled."
            checked={confirmations}
            onCheckedChange={(v) => setConfirmations(v === true)}
          />
          <Checkbox
            label="Reminders"
            description="The day before and two hours before a visit, reminders you ask for, and a request to review a visit afterwards."
            checked={reminders}
            onCheckedChange={(v) => setReminders(v === true)}
          />
        </fieldset>
      )}

      {timeZone && (
        <p className="text-sm text-ink-3">
          Time zone: <span className="font-medium text-ink-2">{timeZone}</span>, from this device.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button type="submit" variant="primary" size="lg" loading={busy} block>
          Continue
        </Button>
        <Button asChild variant="ghost" size="md" block>
          <Link href={next as Route}>Skip for now</Link>
        </Button>
      </div>
    </form>
  );
}

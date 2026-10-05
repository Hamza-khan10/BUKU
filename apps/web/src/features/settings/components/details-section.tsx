'use client';

import { zText } from '@buku/validation';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { ME_KEY, updateProfile, type Me } from '@/features/auth/api';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { useMinute } from '@/features/booking/notice';
import { ApiError } from '@/lib/api/errors';
import { zoneLabel, zoneOptions } from '../zones';
import { SettingsSection } from './section';

const NAME = zText({ kind: 'personName', min: 1, max: 100 });

/** This device's time zone; null while rendering on the server. */
const noChange = () => () => undefined;
const useDeviceTimeZone = () =>
  useSyncExternalStore(
    noChange,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );

/**
 * The name businesses see, and the account's time zone. Saved together, only
 * what changed; the button says when there's nothing to save.
 */
export function DetailsSection({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const device = useDeviceTimeZone();
  const [name, setName] = useState(me.name);
  const [timeZone, setTimeZone] = useState(me.timezone);
  const [nameError, setNameError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  const [busy, setBusy] = useState(false);
  // Labels carry the offsets in force now (they move with daylight saving): worked out once an hour.
  const minute = useMinute();
  const hour = minute === null ? null : Math.floor(minute / 3_600_000);
  const now = useMemo(() => (hour === null ? null : new Date(hour * 3_600_000)), [hour]);
  const zones = useMemo(
    () => (now ? zoneOptions(me.timezone, now) : [{ value: me.timezone, label: me.timezone }]),
    [me.timezone, now],
  );

  const changed = name.trim() !== me.name || timeZone !== me.timezone;

  const save = async (e: FormEvent<HTMLFormElement>) => {
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
    const change = {
      ...(parsed.data !== me.name && { name: parsed.data }),
      ...(timeZone !== me.timezone && { timezone: timeZone }),
    };
    if (Object.keys(change).length === 0) return;

    setBusy(true);
    try {
      // The form starts again from what was saved (it's keyed by the saved details).
      queryClient.setQueryData(ME_KEY, await updateProfile(change));
      toast.success('Your details are saved.');
    } catch (err) {
      const issue = err instanceof ApiError ? err.fieldIssues.find((i) => i.path === 'name') : undefined;
      if (issue) setNameError(issue.message);
      else setProblem(problemFrom(err, 'Your details couldn’t be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Your details">
      <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-5">
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

        <Field
          label="Time zone"
          required
          optionalLabel={false}
          hint="Notices about your own plan come in the daytime here. Times of visits are always the business’s local time."
        >
          <Select name="timezone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </Select>
        </Field>
        {device && device !== timeZone && (
          <Button
            type="button"
            variant="link"
            className="-mt-3 w-fit justify-start text-left whitespace-normal"
            onClick={() => setTimeZone(device)}
          >
            Use this device’s time zone: {now ? zoneLabel(device, now) : device}
          </Button>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!changed && !busy}>
            Save changes
          </Button>
          {!changed && <span className="text-sm text-ink-3">Nothing to save.</span>}
        </div>
      </form>
    </SettingsSection>
  );
}

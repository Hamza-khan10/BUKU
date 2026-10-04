'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Switch } from '@/components/ui/choice';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { fetchMe, ME_KEY } from '@/features/auth/api';
import { ApiError } from '@/lib/api/errors';
import { fetchPrefs, PREFS_KEY, updatePrefs, type NotificationPrefs, type PrefsChange } from '../api';

function Group({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
        {intro && <p className="text-sm text-ink-3">{intro}</p>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/**
 * Which messages come, and how — only the ways BUKU reaches someone on the
 * website today: the inbox (always), email (to a verified address), and
 * suggestions as an explicit opt-in. Each switch saves at once (and says so),
 * and puts itself back if saving didn't work. What can't be switched off is
 * said too, with why.
 */
export function NotificationSettings() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: fetchPrefs });
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });

  if (prefs.isPending || me.isPending) {
    return (
      <div role="status" aria-label="Loading your settings" className="flex flex-col gap-4">
        <Skeleton className="h-44" />
        <Skeleton className="h-36" />
      </div>
    );
  }
  if (prefs.isError) {
    const e = prefs.error instanceof ApiError ? prefs.error : null;
    return (
      <ErrorState
        title="We couldn’t load your settings"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }

  const p = prefs.data;
  const email = me.data?.email ?? null;
  const team = me.data?.role === 'business_owner' || me.data?.account.type === 'employee';

  const set = async (change: PrefsChange, saved: string) => {
    const before = queryClient.getQueryData<NotificationPrefs>(PREFS_KEY);
    queryClient.setQueryData<NotificationPrefs>(PREFS_KEY, (v) => (v ? { ...v, ...change } : v));
    try {
      queryClient.setQueryData(PREFS_KEY, await updatePrefs(change));
      toast.success(saved);
    } catch (err) {
      queryClient.setQueryData(PREFS_KEY, before);
      toast.error(err instanceof ApiError ? err.message : 'That didn’t save. Please try again.');
    }
  };

  const toggle = (key: keyof PrefsChange, label: string) => (on: boolean) =>
    void set({ [key]: on }, `${label}: ${on ? 'on' : 'off'}.`);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {email && (
        <Group title="Email" intro={<>Sent to {email}.</>}>
          <Switch
            label="Booking updates"
            description="When a booking is confirmed, declined, moved or cancelled."
            checked={p.emailBookingConfirmation}
            onCheckedChange={toggle('emailBookingConfirmation', 'Booking update emails')}
          />
          <Switch
            label="Reminders"
            description="The day before and two hours before a visit, reminders you ask for, and a request to review a visit afterwards."
            checked={p.emailReminders}
            onCheckedChange={toggle('emailReminders', 'Reminder emails')}
          />
          {team && (
            <Switch
              label="Business alerts"
              description="New bookings and requests, cancellations, moves and reviews at your business."
              checked={p.emailBusinessAlerts}
              onCheckedChange={toggle('emailBusinessAlerts', 'Business alert emails')}
            />
          )}
        </Group>
      )}

      <Group
        title="Suggestions"
        intro="Off unless you turn them on. At most one a week, never at night, and they stop after a few if you don’t book."
      >
        <Switch
          label="Suggest times that suit me"
          description="When your usual visit is due, an opening at a place you go, or a place you haven’t been back to in a while. They arrive in your inbox."
          checked={p.suggestions}
          // Off means off everywhere: the API would still email them while "also by email" is on.
          onCheckedChange={(on) =>
            void set(
              on ? { suggestions: true } : { suggestions: false, marketingEmails: false },
              `Suggestions: ${on ? 'on' : 'off'}.`,
            )
          }
        />
        {email && (
          <Switch
            label="Also by email"
            description="Suggestions by email too."
            checked={p.marketingEmails}
            disabled={!p.suggestions}
            onCheckedChange={toggle('marketingEmails', 'Suggestions by email')}
          />
        )}
      </Group>

      <Group title="Always sent">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>Everything also goes to your inbox here, so nothing is ever only in an email.</li>
          <li>Being called in a queue: your live ticket shows it the moment it happens.</li>
          <li>Notices about your plan, like a trial ending or a payment that didn’t go through.</li>
        </ul>
      </Group>
    </div>
  );
}

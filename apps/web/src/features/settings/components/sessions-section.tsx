'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { problemFrom } from '@/features/auth/problems';
import { useMinute } from '@/features/booking/notice';
import { ago } from '@/features/notifications/time';
import { endSession, fetchSessions, SESSIONS_KEY, type SignedInDevice } from '../api';
import { deviceLabel, isPhone, sortedDevices } from '../devices';
import { SettingsSection } from './section';

/**
 * Every device signed in to the account, this browser first: which, since
 * when, last active, and from roughly where (a shortened address). Any other
 * one can be signed out on its own; "everywhere" is one step away.
 */
export function SessionsSection() {
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: fetchSessions });
  const minute = useMinute();

  return (
    <SettingsSection
      title="Where you’re signed in"
      intro="Don’t recognise one? Sign it out, and turn on two-step sign-in."
    >
      {sessions.isPending || minute === null ? (
        <Skeleton className="h-28" />
      ) : sessions.isError ? (
        <p className="text-sm text-danger">
          {problemFrom(sessions.error, 'We couldn’t load your devices. Please try again in a moment.').title}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line">
            {sortedDevices(sessions.data).map((s) => (
              <DeviceRow key={s.id} session={s} now={minute} />
            ))}
          </ul>
          {sessions.data.length > 1 && (
            <Button asChild variant="secondary" className="w-fit">
              <Link href="/signout">Sign out everywhere…</Link>
            </Button>
          )}
        </>
      )}
    </SettingsSection>
  );
}

function DeviceRow({ session: s, now }: { session: SignedInDevice; now: number }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const name = deviceLabel(s);
  const Icon = isPhone(s) ? Smartphone : Monitor;

  const signOut = async () => {
    setBusy(true);
    try {
      await endSession(s.id);
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      toast(`Signed out on ${name}.`);
    } catch (err) {
      setBusy(false);
      toast.error(problemFrom(err, 'Signing it out didn’t work. Please try again.').title);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <Icon className="size-5 shrink-0 text-ink-3" aria-hidden />
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {name}
          {s.current && <Badge tone="brand">This browser</Badge>}
        </p>
        <p className="text-sm text-ink-3">
          Signed in {ago(s.signedInAt, now)}
          {!s.current && <> · active {ago(s.lastActiveAt, now)}</>}
          {s.ipAddress && <> · network {s.ipAddress}</>}
        </p>
      </div>
      {!s.current && (
        <Button variant="ghost" size="sm" loading={busy} onClick={() => void signOut()}>
          Sign out<span className="sr-only"> on {name}</span>
        </Button>
      )}
    </li>
  );
}

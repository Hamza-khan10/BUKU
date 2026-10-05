'use client';

import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { fetchMe, ME_KEY, type Me } from '@/features/auth/api';
import { ApiError } from '@/lib/api/errors';
import { DataSection } from './data-section';
import { DetailsSection } from './details-section';
import { PictureSection } from './picture-section';
import { SettingsSection } from './section';
import { SessionsSection } from './sessions-section';
import { TwoStepSection } from './two-step-section';

/**
 * The account's own settings: picture, name and time zone, how the account
 * signs in (two-step sign-in, signed-in devices) — only what can be changed
 * here today, and why the rest can't.
 */
export function AccountSettings() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe });

  if (me.isPending) {
    return (
      <div role="status" aria-label="Loading your settings" className="flex max-w-2xl flex-col gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (me.isError) {
    const e = me.error instanceof ApiError ? me.error : null;
    return (
      <ErrorState
        title="We couldn’t load your settings"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PictureSection me={me.data} />
      <DetailsSection key={`${me.data.name}|${me.data.timezone}`} me={me.data} />
      <SignInDetails me={me.data} />
      <TwoStepSection me={me.data} />
      <SessionsSection />
      <DataSection me={me.data} />
    </div>
  );
}

function SignInDetails({ me }: { me: Me }) {
  const rows =
    me.account.type === 'employee'
      ? [
          { label: 'Username', value: me.account.username ?? '—' },
          { label: 'Account', value: 'Created by your business, which decides what it can do.' },
        ]
      : [{ label: 'Email', value: me.email ?? 'No email on this account' }];
  return (
    <SettingsSection
      title="How you sign in"
      intro={
        me.account.type === 'employee'
          ? undefined
          : 'Your email comes from the account you sign in with. Booking emails go to it.'
      }
    >
      <dl className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="w-24 shrink-0 text-sm font-medium text-ink-2">{r.label}</dt>
            <dd className="text-sm break-all text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );
}

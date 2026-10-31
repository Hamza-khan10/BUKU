import type { Metadata } from 'next';
import { AccountsConsole } from '@admin/components/accounts-console';
import { Card, Notice, PageTitle } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';

export const metadata: Metadata = { title: 'Accounts' };

/**
 * People's accounts (3.6): find one by email or ID, then suspend it, reinstate it, or sign the
 * person out everywhere. One at a time on purpose: there is no list of everyone.
 */
export default async function AccountsPage() {
  const gate = await requireAdmin('/accounts');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  return (
    <>
      <PageTitle
        title="Accounts"
        description="Find a person’s account by email or ID. Suspend one that’s abusing BUKU or was taken over, or sign someone out everywhere after a stolen phone."
      />
      <div className="mb-8">
        <AccountsConsole />
      </div>
      <Card title="What each step does">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>
            Suspend: signed out on every device at once (their access stops within seconds) and refused at
            sign-in until reinstated. Their bookings and businesses stay as they are.
          </li>
          <li>Sign out everywhere: every device signed out; the account stays usable.</li>
          <li>
            Every look and every step is recorded under your name, and on the person’s own record. Platform
            admins and your own account can’t be changed here.
          </li>
        </ul>
      </Card>
    </>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DevSignIn } from '@admin/components/dev-sign-in';
import { Card, Notice } from '@admin/components/ui';
import { adminGate } from '@admin/lib/admin';
import { devSignInEnabled } from '@admin/lib/env';

export const metadata: Metadata = { title: 'Sign in' };

/** Only known reasons are shown, never text from the address. */
const REASONS: Record<string, { tone: 'danger' | 'info'; title: string }> = {
  'not-admin': {
    tone: 'danger',
    title: 'That account isn’t a BUKU platform admin, so it was signed out here.',
  },
  expired: { tone: 'info', title: 'That sign-in expired. Please start again.' },
};

export default async function SignInPage({ searchParams }: PageProps<'/signin'>) {
  const gate = await adminGate();
  if (gate.kind === 'ok') redirect('/');
  if (gate.kind === 'needs-two-step') redirect('/two-step');
  const asked = (await searchParams).error;
  const reason = typeof asked === 'string' && Object.hasOwn(REASONS, asked) ? REASONS[asked] : undefined;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Sign in to BUKU admin</h1>
      {reason && <Notice tone={reason.tone} title={reason.title} />}
      <Card>
        {devSignInEnabled() ? (
          <>
            <Notice title="Development sign-in">
              A new email becomes a platform admin. Never on the live site.
            </Notice>
            <DevSignIn />
          </>
        ) : (
          <Notice title="Admin sign-in isn’t set up on this deployment yet." />
        )}
      </Card>
      <p className="text-sm text-ink-3">
        For BUKU’s own operators only. Customers and businesses use the BUKU website.
      </p>
    </div>
  );
}

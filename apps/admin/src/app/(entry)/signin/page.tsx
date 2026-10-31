import { SIGN_IN_ERRORS } from '@buku/web-security/google-oauth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DevSignIn } from '@admin/components/dev-sign-in';
import { Card, Notice } from '@admin/components/ui';
import { adminGate } from '@admin/lib/admin';
import { devSignInEnabled, googleSignInEnabled } from '@admin/lib/env';

export const metadata: Metadata = { title: 'Sign in' };

/** This app's own endpoint (not a page, so a plain link: <Link> would prefetch it). */
const GOOGLE_START = '/api/auth/google/start';

/** Only known reasons are shown, never text from the address. */
const REASONS: Record<string, { tone: 'danger' | 'info'; title: string }> = {
  ...Object.fromEntries(
    Object.entries(SIGN_IN_ERRORS).map(([code, title]) => [code, { tone: 'danger' as const, title }]),
  ),
  'not-admin': {
    tone: 'danger',
    title: 'That account isn’t a BUKU platform admin. Nothing here is open to it.',
  },
  expired: { tone: 'info', title: 'That sign-in expired. Please start again.' },
};

export default async function SignInPage({ searchParams }: PageProps<'/signin'>) {
  const gate = await adminGate();
  if (gate.kind === 'ok') redirect('/');
  if (gate.kind === 'needs-two-step') redirect('/two-step');
  const asked = (await searchParams).error;
  const reason = typeof asked === 'string' && Object.hasOwn(REASONS, asked) ? REASONS[asked] : undefined;
  const google = googleSignInEnabled();
  const dev = devSignInEnabled();

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Sign in to BUKU admin</h1>
      {reason && <Notice tone={reason.tone} title={reason.title} />}
      <Card>
        {google && (
          // A plain link to this app's own endpoint: the sign-in happens on the server (D-090).
          <a
            href={GOOGLE_START}
            className="inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-ink hover:opacity-90"
          >
            Continue with Google
          </a>
        )}
        {dev && (
          <>
            <Notice title="Development sign-in">
              A new email becomes a platform admin. Never on the live site.
            </Notice>
            <DevSignIn />
          </>
        )}
        {!google && !dev && <Notice title="Admin sign-in isn’t set up on this deployment yet." />}
      </Card>
      <p className="text-sm text-ink-3">
        For BUKU’s own operators only. Customers and businesses use the BUKU website.
      </p>
    </div>
  );
}

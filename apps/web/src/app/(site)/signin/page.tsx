import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { DevSignInForm } from '@/features/auth/components/dev-sign-in-form';
import { GoogleButton } from '@/features/auth/components/google-button';
import { OtherWayIn, SignInShell } from '@/features/auth/components/sign-in-shell';
import { signInHref } from '@/features/auth/paths';
import { SIGN_IN_ERRORS, signInErrorFrom, type SignInError } from '@/lib/auth/google';
import { devSignInEnabled, googleSignInEnabled } from '@/lib/flags';
import { safeNext } from '@/lib/session/next';
import { signedInHere } from '@/lib/session/server';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to book appointments, join queues and see your visits.',
  robots: { index: false, follow: false },
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** "3 November 2026", from the API's purge day ("2026-11-03"); null for anything else. */
function dayLabel(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** Why the last Google sign-in came back unfinished, in words — and, for a deletion, the way back. */
function SignInProblem({ error, next, until }: { error: SignInError; next: string; until: string | null }) {
  if (error === 'deletion-pending') {
    return (
      <Alert
        tone="wait"
        title={`${SIGN_IN_ERRORS[error]}${until ? ` It will be deleted for good on ${until}.` : ''}`}
        action={<GoogleButton next={next} restore label="Restore and sign in" />}
      >
        Until then you can change your mind: restoring keeps everything as it was.
      </Alert>
    );
  }
  const tone = error === 'google-cancelled' ? 'info' : 'danger';
  return (
    <Alert tone={tone} title={SIGN_IN_ERRORS[error]}>
      {error === 'account-suspended' && (
        <Link href="/contact" className="font-medium text-brand-ink underline underline-offset-4">
          Contact us
        </Link>
      )}
    </Alert>
  );
}

/**
 * Signing in. Someone already signed in goes straight on to where they were
 * heading. The ways in are only the ones this site really offers: Google
 * where it is set up, development sign-in on development and test sites.
 * Employees of a business sign in with their username on their own page.
 */
export default async function SignInPage({ searchParams }: PageProps<'/signin'>) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await signedInHere()) redirect(next as Route);
  const error = signInErrorFrom(params.error);
  const google = googleSignInEnabled();
  const dev = devSignInEnabled();

  return (
    <SignInShell
      title="Sign in to BUKU"
      lead="Book appointments, join queues and keep every visit in one place."
      after={
        <OtherWayIn href={signInHref('business', next)} label="Sign in with your username">
          Work at a business on BUKU?
        </OtherWayIn>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <SignInProblem error={error} next={next} until={dayLabel(first(params.until))} />}
        {google && error !== 'deletion-pending' && <GoogleButton next={next} />}
        {google && dev && (
          <p className="flex items-center gap-3 text-xs font-medium tracking-wide text-ink-3 uppercase">
            <span className="h-px flex-1 bg-line" aria-hidden />
            Or, on this development site
            <span className="h-px flex-1 bg-line" aria-hidden />
          </p>
        )}
        {dev && <DevSignInForm next={next} />}
        {!google && !dev && (
          <Alert title="Signing in isn’t open on this site yet">
            You can browse every business, its prices and opening hours without an account. Signing in with
            Google is being set up.
          </Alert>
        )}
      </div>
    </SignInShell>
  );
}

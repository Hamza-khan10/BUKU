import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { DevSignInForm } from '@/features/auth/components/dev-sign-in-form';
import { OtherWayIn, SignInShell } from '@/features/auth/components/sign-in-shell';
import { signInHref } from '@/features/auth/paths';
import { devSignInEnabled } from '@/lib/flags';
import { safeNext } from '@/lib/session/next';
import { signedInHere } from '@/lib/session/server';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to book appointments, join queues and see your visits.',
  robots: { index: false, follow: false },
};

/**
 * Signing in. Someone already signed in goes straight on to where they were
 * heading. The ways in are only the ones this site really offers: development
 * sign-in on development and test sites; Google joins when it is set up.
 * Employees of a business sign in with their username on their own page.
 */
export default async function SignInPage({ searchParams }: PageProps<'/signin'>) {
  const next = safeNext((await searchParams).next);
  if (await signedInHere()) redirect(next as Route);

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
      {devSignInEnabled() ? (
        <DevSignInForm next={next} />
      ) : (
        <Alert title="Signing in isn’t open on this site yet">
          You can browse every business, its prices and opening hours without an account. Signing in with
          Google is being set up.
        </Alert>
      )}
    </SignInShell>
  );
}

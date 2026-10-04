import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { BusinessSignInForm } from '@/features/auth/components/business-sign-in-form';
import { OtherWayIn, SignInShell } from '@/features/auth/components/sign-in-shell';
import { businessHandleFrom, usernameFrom } from '@/features/auth/handles';
import { signInHref } from '@/features/auth/paths';
import { apiConfigured } from '@/lib/flags';
import { safeNext } from '@/lib/session/next';
import { signedInHere } from '@/lib/session/server';

export const metadata: Metadata = {
  title: 'Sign in to your business',
  description: 'For employees: sign in with the username and password your business gave you.',
  robots: { index: false, follow: false },
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Employee sign-in: the accounts a business creates for its team (front desk,
 * staff), with a username and password instead of a Google account. A link
 * can fill in the business and username (`?business=salt-and-pepper&username=ali`).
 */
export default async function BusinessSignInPage({ searchParams }: PageProps<'/signin/business'>) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await signedInHere()) redirect(next as Route);

  return (
    <SignInShell
      title="Sign in to your business"
      lead="For the team: use the username and password your business gave you."
      after={
        <OtherWayIn href={signInHref('signin', next)} label="Sign in to your own account">
          Booking for yourself?
        </OtherWayIn>
      }
    >
      {apiConfigured() ? (
        <BusinessSignInForm
          next={next}
          initialBusiness={businessHandleFrom(first(params.business)) ?? undefined}
          initialUsername={usernameFrom(first(params.username)) ?? undefined}
        />
      ) : (
        <Alert title="Signing in isn’t open on this site yet">
          You can browse every business, its prices and opening hours without an account.
        </Alert>
      )}
    </SignInShell>
  );
}

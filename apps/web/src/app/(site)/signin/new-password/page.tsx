import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { NewPasswordPanel } from '@/features/auth/components/new-password-panel';
import { SignInShell } from '@/features/auth/components/sign-in-shell';
import { signInHref } from '@/features/auth/paths';
import { safeNext } from '@/lib/session/next';
import { signedInHere } from '@/lib/session/server';

export const metadata: Metadata = {
  title: 'Choose your password',
  description: 'Replace the temporary password your business gave you.',
  robots: { index: false, follow: false },
};

/**
 * An employee signed in on a temporary password replaces it here before
 * anything else. Signed out, they sign in first (which asks for the new
 * password in place).
 */
export default async function NewPasswordPage({ searchParams }: PageProps<'/signin/new-password'>) {
  const next = safeNext((await searchParams).next);
  if (!(await signedInHere())) redirect(signInHref('business', next) as Route);

  return (
    <SignInShell
      title="Choose your password"
      lead="One step before you start: a password only you know."
      terms={false}
    >
      <NewPasswordPanel next={next} />
    </SignInShell>
  );
}

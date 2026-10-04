import type { Metadata } from 'next';
import { SignInShell } from '@/features/auth/components/sign-in-shell';
import { WelcomeForm } from '@/features/auth/components/welcome-form';
import { safeNext } from '@/lib/session/next';

export const metadata: Metadata = {
  title: 'Welcome',
  description: 'A couple of choices for your new BUKU account.',
  robots: { index: false, follow: false },
};

/**
 * First stop for a new account (signed-out visitors are sent to sign in by
 * the proxy): the name businesses see and which emails to get, then on to
 * where they were going.
 */
export default async function WelcomePage({ searchParams }: PageProps<'/welcome'>) {
  const next = safeNext((await searchParams).next);
  return (
    <SignInShell title="Welcome to BUKU" lead="Two quick choices, then you’re on your way." terms={false}>
      <WelcomeForm next={next} />
    </SignInShell>
  );
}

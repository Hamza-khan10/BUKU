import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { OtherWayIn, SignInShell } from '@/features/auth/components/sign-in-shell';
import { TwoStepForm } from '@/features/auth/components/two-step-form';
import { signInHref, startFrom } from '@/features/auth/paths';
import { safeNext } from '@/lib/session/next';
import { pendingChallenge, signedInHere } from '@/lib/session/server';

export const metadata: Metadata = {
  title: 'Enter your code',
  description: 'The second step of signing in: the code from your authenticator app.',
  robots: { index: false, follow: false },
};

/**
 * Two-step sign-in, second step. Reached right after the password (or
 * Google) for accounts that use an authenticator app; without a sign-in
 * waiting in this browser there is nothing to enter, and it says so.
 */
export default async function VerifyPage({ searchParams }: PageProps<'/signin/verify'>) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const start = startFrom(params.start);
  if (await signedInHere()) redirect(next as Route);
  const challenge = await pendingChallenge();

  return (
    <SignInShell
      title="Enter your code"
      lead="Your account uses two-step sign-in: one more step and you’re in."
      terms={false}
      after={
        <OtherWayIn href="/contact" label="Contact us">
          Lost your phone and your recovery codes?
        </OtherWayIn>
      }
    >
      {challenge ? (
        <TwoStepForm next={next} start={start} expiresAt={challenge.expiresAt} />
      ) : (
        <div className="flex flex-col gap-5">
          <Alert tone="wait" title="There’s no sign-in waiting for a code">
            The code step only stays open for a few minutes after you sign in, and only in the browser you
            signed in with. Start again — it only takes a moment.
          </Alert>
          <Button asChild variant="primary" size="lg" block>
            <Link href={signInHref(start, next) as Route}>Sign in</Link>
          </Button>
        </div>
      )}
    </SignInShell>
  );
}

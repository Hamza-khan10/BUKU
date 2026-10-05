import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout';
import { DELETION_GRACE_DAYS, longDate, untilFrom } from '@/features/settings/my-data';

export const metadata: Metadata = {
  title: 'Your account is deleted',
  robots: { index: false, follow: false },
};

/**
 * After deleting an account (signed out by then): when it's gone for good,
 * and how to change one's mind before that. The date comes from the address
 * and is only shown if it's a real date.
 */
export default async function GoodbyePage({ searchParams }: PageProps<'/goodbye'>) {
  const until = untilFrom((await searchParams).until);
  return (
    <Container className="flex justify-center py-16 sm:py-24">
      <div className="flex w-full max-w-lg flex-col gap-5">
        <h1 className="font-display text-4xl font-bold tracking-tight">Your account is deleted</h1>
        <p className="text-ink-2">
          You’re signed out everywhere, and visits still to come are cancelled.{' '}
          {until ? (
            <>
              Your details will be removed for good on <strong className="text-ink">{longDate(until)}</strong>
              .
            </>
          ) : (
            <>Your details will be removed for good in {DELETION_GRACE_DAYS} days.</>
          )}
        </p>
        <p className="text-ink-2">
          Changed your mind? Sign in again before then and choose to restore your account.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link href="/">Back to BUKU</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/signin">Sign in to restore</Link>
          </Button>
        </div>
      </div>
    </Container>
  );
}

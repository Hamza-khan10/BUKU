'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, ME_KEY, mustChangePassword } from '../api';
import { signInHref } from '../paths';
import { problemFrom } from '../problems';
import { NewPasswordForm } from './new-password-form';
import { ProblemAlert } from './problem-alert';

/**
 * Replacing a temporary password when the sign-in form isn't the way here
 * (after the two-step code, or coming back later): who is signed in, and
 * their business's handle to sign back in afterwards, come from the API.
 */
export function NewPasswordPanel({ next }: { next: string }) {
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
  });
  const account = me.data?.account;
  const businessId = account?.type === 'employee' ? account.businessId : null;
  const business = useQuery({
    queryKey: ['business-handle', businessId],
    queryFn: () => api<{ slug: string }>(`businesses/${businessId}`),
    enabled: Boolean(businessId),
    retry: false,
  });

  if (me.isPending || (businessId && business.isPending)) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-4">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
        <Skeleton className="h-13" />
      </div>
    );
  }

  if (me.error) {
    const ended = me.error instanceof ApiError && me.error.status === 401;
    return (
      <div className="flex flex-col gap-5">
        <ProblemAlert
          problem={
            ended
              ? { title: 'Your session has ended. Please sign in again.' }
              : problemFrom(me.error, 'We couldn’t load your account. Please try again.')
          }
        />
        {ended && (
          <Button asChild variant="primary" size="lg" block>
            <Link href={signInHref('business', next) as Route}>Sign in again</Link>
          </Button>
        )}
      </div>
    );
  }

  if (!mustChangePassword(me.data) || account?.type !== 'employee' || !account.username) {
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="ok" title="Your password is already your own">
          There’s nothing to change here.
        </Alert>
        <Button asChild variant="primary" size="lg" block>
          <Link href={next as Route}>Continue</Link>
        </Button>
      </div>
    );
  }

  return <NewPasswordForm username={account.username} business={business.data?.slug ?? null} next={next} />;
}

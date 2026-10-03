'use client';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';

/**
 * Something failed while showing a page. People get a way forward (try again)
 * and a reference to quote; the details stay in the server's logs.
 */
export default function PageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorState
      className="min-h-[60dvh] justify-center"
      title="This page didn’t load"
      message="Something went wrong on our side while showing this page. Trying again usually fixes it."
      reference={error.digest}
      action={
        <Button variant="primary" onClick={() => retry()}>
          Try again
        </Button>
      }
    />
  );
}

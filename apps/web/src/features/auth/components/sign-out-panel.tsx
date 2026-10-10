'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { signOut, signOutEverywhere } from '../api';

/**
 * Two choices: this device, or every device. Either ends the sessions at the
 * API, not just in this browser. Nothing happens until a button is pressed
 * (a link to this page can't sign anyone out).
 */
export function SignOutPanel({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<
    'idle' | 'busy' | 'done' | { error: string; reference?: string | undefined }
  >(signedIn ? 'idle' : 'done');

  const run = async (everywhere: boolean) => {
    setState('busy');
    try {
      if (everywhere) await signOutEverywhere();
      else await signOut();
      queryClient.clear();
      setState('done');
      router.refresh();
    } catch (e) {
      setState({
        error: e instanceof ApiError ? e.message : 'Signing out didn’t work. Please try again.',
        reference: e instanceof ApiError ? e.requestId : undefined,
      });
    }
  };

  if (state === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <CheckCircle2 className="size-12 text-ok" aria-hidden />
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">You’re signed out</h1>
        <p className="text-ink-2">See you next time.</p>
        <div className="flex gap-3">
          <Button asChild variant="primary">
            <Link href="/">Go to the home page</Link>
          </Button>
          <Button asChild>
            <Link href="/signin">Sign in again</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-6 shadow-soft sm:p-8">
      <h1 className="text-3xl font-semibold tracking-[-0.03em]">Sign out</h1>
      {typeof state === 'object' && (
        <Alert tone="danger" title={state.error}>
          {state.reference && <span className="font-mono text-xs">Reference: {state.reference}</span>}
        </Alert>
      )}
      <div className="flex flex-col gap-3">
        <Button variant="primary" size="lg" block loading={state === 'busy'} onClick={() => void run(false)}>
          Sign out of this device
        </Button>
        <Button size="lg" block disabled={state === 'busy'} onClick={() => void run(true)}>
          Sign out of every device
        </Button>
      </div>
      <p className="text-sm text-ink-3">
        “Every device” ends all your sessions: useful after using a shared computer or losing a phone.
      </p>
    </div>
  );
}

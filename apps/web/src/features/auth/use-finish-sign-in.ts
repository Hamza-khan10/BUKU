'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toaster';
import { isSignedIn } from '@/lib/api/client';
import { ME_KEY, mustChangePassword, needsTwoStep, type SignInAnswer } from './api';
import { verifyHref, welcomeHref, type SignInStart } from './paths';

export const COOKIES_BLOCKED =
  'Your browser didn’t keep BUKU’s sign-in cookies. Allow cookies for this site and try again.';

/**
 * What happens after a sign-in answer, the same for every way in:
 *  • 'two-step'      — the code comes next: on to /signin/verify;
 *  • 'new-password'  — signed in on a temporary password: the caller asks for a new one;
 *  • 'no-cookies'    — the browser refused the session cookies: the caller says so;
 *  • 'done'          — welcomed, and on to where they were going (a new account via /welcome).
 */
export type FinishOutcome = 'two-step' | 'new-password' | 'no-cookies' | 'done';

export interface FinishOptions {
  next: string;
  start: SignInStart;
  /** The greeting, given the person's first name. */
  welcome?: (first: string) => string;
}

export function useFinishSignIn() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (answer: SignInAnswer, { next, start, welcome }: FinishOptions): FinishOutcome => {
    if (needsTwoStep(answer)) {
      router.push(verifyHref(start, next) as Route);
      return 'two-step';
    }
    if (!isSignedIn()) return 'no-cookies';
    queryClient.setQueryData(ME_KEY, answer.user);
    if (mustChangePassword(answer.user)) return 'new-password';
    const first = answer.user.name.split(' ')[0] ?? '';
    const greeting = answer.isNewUser ? `Welcome to BUKU, ${first}` : `Welcome back, ${first}`;
    toast.success(welcome ? welcome(first) : greeting);
    // A new account first sees /welcome (a couple of choices), then goes on.
    router.replace((answer.isNewUser ? welcomeHref(next) : next) as Route);
    router.refresh();
    return 'done';
  };
}

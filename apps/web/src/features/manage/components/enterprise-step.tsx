'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { HeldDot } from '@/components/brand/held-dot';
import { Button } from '@/components/ui/button';
import { ProblemAlert } from '@/features/auth/components/problem-alert';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { fetchMine, MINE_KEY } from '../api';
import { askForPlan } from '../billing-api';

/** What the API says when an account is full (D-147): its cap, and whether it's a Network chain. */
export interface AccountFull {
  max: number;
  fromNetwork: boolean;
}

/** The details of a refusal at the cap, or null for any other refusal. */
export function accountFullFrom(err: unknown): AccountFull | null {
  if (!(err instanceof ApiError) || err.code !== 'PLAN_LIMIT_REACHED') return null;
  const d = err.details as { limit?: unknown; max?: unknown; fromNetwork?: unknown } | undefined;
  if (d?.limit !== 'businesses' || typeof d.max !== 'number') return null;
  return { max: d.max, fromNetwork: d.fromNetwork === true };
}

const ORDINALS: Record<number, string> = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth' };
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;

/**
 * The step past the cap (3.7k, D-146): an owner with an account full of businesses asks for
 * Enterprise. A Network chain reaching its sixth branch gets the milestone (the logo's dot lands
 * on it) and the gift for the new branch; anyone else, the plain way up. The request goes on one
 * of their businesses; an operator moves every branch, then this one can be added. Nothing typed
 * in the form is lost: this sits above it.
 */
export function EnterpriseStep({
  full,
  branch,
}: {
  full: AccountFull;
  /** The branch being added, for the request's message. */
  branch: { name: string; city: string };
}) {
  const headingId = useId();
  const box = useRef<HTMLElement>(null);
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: fetchMine });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'already'>('idle');
  const [problem, setProblem] = useState<Problem | undefined>();

  // Shown after pressing "Add" at the foot of a long form: brought into view and read out.
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'center' });
    box.current?.focus({ preventScroll: true });
  }, []);

  const next = ordinal(full.max + 1);
  const owned = mine.data?.find((b) => b.myRole === 'owner');

  const ask = async () => {
    if (!owned) return;
    setState('sending');
    setProblem(undefined);
    const where = [branch.name.trim(), branch.city.trim()].filter(Boolean).join(' in ');
    const message = full.fromNetwork
      ? `Moving up from Network: adding our ${next} branch${where ? `, ${where}` : ''}.`
      : `Adding more than ${full.max} businesses${where ? `: ${where}` : ''}.`;
    try {
      await askForPlan(owned.id, 'business_enterprise', message);
      setState('sent');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return setState('already');
      setProblem(problemFrom(err, 'Your request couldn’t be sent. Please try again.'));
      setState('idle');
    }
  };

  return (
    <section
      ref={box}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl bg-brand-soft p-6 outline-none ring-1 ring-brand/20 sm:p-8"
    >
      {state === 'sent' || state === 'already' ? (
        // Read out as it appears (the button that was pressed is gone).
        <div role="status" className="flex flex-col gap-4">
          <h2 id={headingId} className="type-heading">
            {state === 'sent' ? 'Request sent' : 'Your request is already with us'}
            <HeldDot />
          </h2>
          <p className="max-w-[58ch] text-ink-2">
            We’ll move all your businesses to Enterprise. When it’s done, your plan page says so, and this
            branch can be added: what you’ve typed below stays here while this page is open.
          </p>
          {owned && (
            <Link
              href={`/business/${owned.id}/billing` as Route}
              className="self-start font-semibold text-brand-ink underline underline-offset-4"
            >
              See your plan
            </Link>
          )}
        </div>
      ) : full.fromNetwork ? (
        <>
          <h2 id={headingId} className="type-heading">
            Your {next} branch
            <HeldDot />
          </h2>
          <p className="max-w-[58ch] text-ink-2">
            That makes you a chain. Network covers up to {full.max} branches; from {full.max + 1}, BUKU is
            Enterprise: everything unlimited, help setting up every branch, and this branch’s first ad free
            once ads open on BUKU. Your price a branch stays the same.
          </p>
        </>
      ) : (
        <>
          <h2 id={headingId} className="type-heading">
            More than {full.max} businesses is Enterprise
          </h2>
          <p className="max-w-[58ch] text-ink-2">
            An account holds up to {full.max} businesses. From {full.max + 1}, BUKU is Enterprise: everything
            unlimited and help setting up every branch.
          </p>
        </>
      )}
      {(state === 'idle' || state === 'sending') && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            variant="primary"
            loading={state === 'sending'}
            disabled={!owned}
            onClick={() => void ask()}
          >
            Request Enterprise
          </Button>
          <p className="text-sm text-ink-2">Nothing you’ve typed below is lost.</p>
        </div>
      )}
      <ProblemAlert problem={problem} />
    </section>
  );
}

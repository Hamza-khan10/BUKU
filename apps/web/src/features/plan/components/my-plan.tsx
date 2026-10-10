'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { problemFrom } from '@/features/auth/problems';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import {
  fetchMyPlan,
  keepRenewing,
  paymentPages,
  PLAN_KEY,
  startTrial,
  stopRenewing,
  type MyPlan,
} from '../api';
import { planStory, usageLines } from '../story';

/** The limits' names, from the same catalog the pricing page shows. */
const useLimitLabels = () =>
  useQuery({
    queryKey: ['pricing', 'user', 'labels'],
    queryFn: async () => {
      const p = await api<{ comparison: { limits: { key: string; label: string }[] } }>('billing/plans', {
        query: { audience: 'user', channel: 'web' },
      });
      return Object.fromEntries(p.comparison.limits.map((l) => [l.key, l.label]));
    },
    staleTime: 5 * 60_000,
  });

/**
 * The person's plan, said plainly: free for everyone while paid plans are
 * off; otherwise which plan, what's used of its limits, a free trial when
 * one is offered, and — for a plan bought on the website — renewing and
 * payment details. Buying happens on the pricing page once it's open there.
 */
export function MyPlanPanel() {
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: fetchMyPlan });
  const labels = useLimitLabels();

  if (plan.isPending) return <Skeleton className="h-56 max-w-2xl" />;
  if (plan.isError) {
    const e = plan.error instanceof ApiError ? plan.error : null;
    return (
      <ErrorState
        title="We couldn’t load your plan"
        message={e?.message ?? 'Please try again in a moment.'}
        reference={e?.requestId}
      />
    );
  }

  const p = plan.data;
  const story = planStory(p);
  const usage = usageLines(p, labels.data ?? {});

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section
        aria-label="Your plan"
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-[-0.025em] text-ink">{story.title}</h2>
          {p.source === 'trial' && <Badge tone="brand">Free trial</Badge>}
        </div>
        {story.warning && <Alert tone="wait" title={story.warning} />}
        {story.lines.map((line) => (
          <p key={line} className="text-ink-2">
            {line}
          </p>
        ))}
        {usage.length > 0 && (
          <dl className="flex flex-col gap-2 border-t border-line pt-4">
            {usage.map((u) => (
              <div key={u.label} className="flex flex-wrap justify-between gap-2 text-sm">
                <dt className="text-ink-2">{u.label} (in total)</dt>
                <dd className={u.full ? 'font-semibold text-wait-ink' : 'font-medium text-ink'}>{u.text}</dd>
              </div>
            ))}
          </dl>
        )}
        {story.managedIn === 'google_play' && (
          <p className="text-sm text-ink-3">Bought in the app: change or cancel it in Google Play.</p>
        )}
        {story.managedIn === 'app_store' && (
          <p className="text-sm text-ink-3">Bought in the app: change or cancel it in the App Store.</p>
        )}
        {story.managedIn === 'website' && <WebsitePlanActions renewal={story.renewal} />}
      </section>

      {p.trial.available && <TrialOffer trial={p.trial} />}

      <p className="text-sm text-ink-3">
        <Link href="/pricing" className="font-medium text-ink-2 underline underline-offset-4 hover:text-ink">
          See every plan and what it includes
        </Link>
        {p.billingEnabled && p.source !== 'subscription' && '. Plans can’t be bought on the website yet.'}
      </p>
    </div>
  );
}

function TrialOffer({ trial }: { trial: MyPlan['trial'] }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const name = trial.plan?.name ?? 'the paid plan';

  const start = async () => {
    setBusy(true);
    try {
      queryClient.setQueryData(PLAN_KEY, await startTrial());
      toast.success(`Your free trial of ${name} has started.`);
    } catch (err) {
      toast.error(problemFrom(err, 'The trial didn’t start. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Free trial"
      className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-5"
    >
      <h2 className="flex items-center gap-2 text-xl tracking-[-0.02em] font-semibold text-ink">
        <Sparkles className="size-5 text-brand-ink" aria-hidden /> Try {name} free for {trial.days} days
      </h2>
      <p className="text-sm text-ink-2">
        No card needed, and once only. When it ends you’re back on the free plan; nothing is charged.
      </p>
      <Button variant="primary" loading={busy} onClick={() => void start()} className="w-fit">
        Start the free trial
      </Button>
    </section>
  );
}

function WebsitePlanActions({ renewal }: { renewal: 'renews' | 'ends' | null }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'pages' | 'keep' | null>(null);

  const openPaymentPages = async () => {
    setBusy('pages');
    try {
      const pages = await paymentPages();
      const target = new URL(pages.updatePaymentMethod ?? pages.overview);
      // Only ever the payment provider's own pages.
      if (target.protocol !== 'https:' || !/(^|\.)paddle\.com$/.test(target.hostname))
        throw new Error('unexpected');
      window.location.assign(target.toString());
    } catch (err) {
      setBusy(null);
      toast.error(problemFrom(err, 'Your payment details couldn’t be opened. Please try again.').title);
    }
  };

  const keep = async () => {
    setBusy('keep');
    try {
      await keepRenewing();
      await queryClient.invalidateQueries({ queryKey: PLAN_KEY });
      toast.success('Your plan will renew as usual.');
    } catch (err) {
      toast.error(problemFrom(err, 'That didn’t work. Please try again.').title);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 border-t border-line pt-4">
      <Button variant="secondary" loading={busy === 'pages'} onClick={() => void openPaymentPages()}>
        {busy !== 'pages' && <ExternalLink aria-hidden />} Payment details and receipts
      </Button>
      {renewal === 'renews' && <StopRenewing />}
      {renewal === 'ends' && (
        <Button variant="ghost" loading={busy === 'keep'} onClick={() => void keep()}>
          Keep it renewing
        </Button>
      )}
    </div>
  );
}

function StopRenewing() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await stopRenewing();
      await queryClient.invalidateQueries({ queryKey: PLAN_KEY });
      setOpen(false);
      toast('Your plan won’t renew. You keep it until the end of what you’ve paid for.');
    } catch (err) {
      setError(problemFrom(err, 'That didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Stop renewing</Button>
      </DialogTrigger>
      <DialogContent
        title="Stop your plan renewing?"
        description="You keep it until the end of what you’ve paid for, then you’re back on the free plan. You can change your mind until then."
      >
        <div className="flex flex-col gap-4">
          {error && <Alert tone="danger" title={error} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button variant="danger" loading={busy} onClick={() => void stop()}>
              Stop renewing
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

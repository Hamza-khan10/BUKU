'use client';

import { zText } from '@buku/validation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Minus } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select, Textarea } from '@/components/ui/input';
import { PageHeading, SectionHeading } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import type { Pricing } from '@/features/pricing/api';
import { ComparisonTable, PlanCard } from '@/features/pricing/components/plans';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { fetchManaged, managedKey } from '../api';
import {
  everythingIncluded,
  meter,
  planAction,
  REQUEST_STATUS,
  safePaymentUrl,
  standing,
  TRIAL_NOTE,
  type BusinessBilling,
  type PlanRequest,
  type Tone,
} from '../billing';
import {
  askForPlan,
  billingKey,
  businessPlansKey,
  cancelPlan,
  changePlan,
  checkout,
  fetchBilling,
  fetchBusinessPlans,
  fetchPlanRequests,
  keepPlan,
  planRequestsKey,
  portal,
  startTrial,
  withdrawRequest,
} from '../billing-api';

const MESSAGE = zText({ kind: 'text', min: 10, max: 1000 });

const STORE_NAME: Record<string, string> = { google_play: 'Google Play', app_store: 'the App Store' };

/** What went wrong, in the API's words when it said. */
const problem = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t work. Please try again.';

/**
 * /business/[id]/billing (3.5k): the business's plan. Where it stands (free, a trial, paid, given
 * by BUKU, or everything included while BUKU isn't charging), how much of each limit it uses, the
 * free trial, the plans with what each would mean here, and asking BUKU for a plan. Every change
 * is the owner's; the rest of the team sees the same page without the buttons.
 */
export function BillingPage({ id }: { id: string }) {
  const business = useQuery({ queryKey: managedKey(id), queryFn: () => fetchManaged(id) });
  const billing = useQuery({
    queryKey: billingKey(id),
    queryFn: () => fetchBilling(id),
    enabled: business.isSuccess,
  });
  const plans = useQuery({ queryKey: businessPlansKey, queryFn: fetchBusinessPlans, staleTime: 5 * 60_000 });
  const requests = useQuery({
    queryKey: planRequestsKey(id),
    queryFn: () => fetchPlanRequests(id),
    enabled: business.isSuccess,
  });

  const failed = business.error ?? billing.error ?? plans.error ?? requests.error;
  if (failed) {
    const e = failed instanceof ApiError ? failed : null;
    return (
      <ErrorState
        title="We couldn’t load the plan"
        message={e?.message ?? 'Please try again.'}
        reference={e?.requestId}
      />
    );
  }
  if (!business.data || !billing.data || !plans.data || !requests.data)
    return <Skeleton className="h-96 max-w-5xl" />;

  const owner = business.data.myRole === 'owner';
  const tz = business.data.timezone;
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(
      new Date(iso),
    );

  return (
    <div className="flex max-w-5xl flex-col gap-10">
      <PageHeading
        compact
        eyebrow={business.data.name}
        title="Plan"
        description={
          owner
            ? 'Your plan, what it includes and how much of it you use.'
            : 'The business’s plan and how much of it is used. Only the owner can change it.'
        }
      />
      <Standing id={id} b={billing.data} owner={owner} day={day} />
      {owner && billing.data.trial.available && <Trial id={id} b={billing.data} />}
      <UsageCard b={billing.data} pricing={plans.data} />
      <Plans id={id} b={billing.data} pricing={plans.data} owner={owner} />
      <Requests id={id} pricing={plans.data} requests={requests.data} owner={owner} day={day} />
    </div>
  );
}

/** Refresh everything the plan shows after a change. */
function useRefresh(id: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: billingKey(id) });
}

function Standing({
  id,
  b,
  owner,
  day,
}: {
  id: string;
  b: BusinessBilling;
  owner: boolean;
  day: (iso: string) => string;
}) {
  const refresh = useRefresh(id);
  const [busy, setBusy] = useState<'cancel' | 'keep' | 'portal' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { title, detail } = standing(b, day);
  const sub = b.subscription;
  const paddle = owner && sub?.provider === 'paddle' && b.source === 'subscription';

  const run = async (what: 'cancel' | 'keep', work: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await work();
      setConfirming(false);
      toast.success(done);
      await refresh();
    } catch (err) {
      toast.error(problem(err));
    } finally {
      setBusy(null);
    }
  };
  const openPortal = async () => {
    setBusy('portal');
    try {
      const links = await portal(id);
      const url = safePaymentUrl(links.overview, window.location.origin);
      if (!url) throw new Error('unexpected link');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(problem(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="plan-now"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-soft"
    >
      <p className="text-sm text-ink-2">Your plan</p>
      <div className="flex flex-col gap-1.5">
        <h2 id="plan-now" className="text-2xl font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="max-w-2xl text-ink-2">{detail}</p>
        {owner && b.trial.reason && TRIAL_NOTE[b.trial.reason] && (
          <p className="text-sm text-ink-3">{TRIAL_NOTE[b.trial.reason]}</p>
        )}
      </div>
      {paddle && (
        <div className="flex flex-wrap items-center gap-2">
          {sub.cancelAtPeriodEnd ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy === 'keep'}
              onClick={() => void run('keep', () => keepPlan(id), 'Your plan carries on.')}
            >
              Keep my plan
            </Button>
          ) : confirming ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-sunken p-4 text-sm">
              <span className="text-ink-2">
                Cancel {b.plan.name}? It stays until the end of this period, then you’re on the free plan.
              </span>
              <Button
                variant="danger"
                size="sm"
                loading={busy === 'cancel'}
                onClick={() =>
                  void run(
                    'cancel',
                    () => cancelPlan(id),
                    'Cancelled. Your plan stays until the period ends.',
                  )
                }
              >
                Cancel the plan
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              Cancel the plan
            </Button>
          )}
          {!confirming && (
            <Button variant="ghost" size="sm" loading={busy === 'portal'} onClick={() => void openPortal()}>
              Card and invoices
            </Button>
          )}
        </div>
      )}
      {owner && sub && STORE_NAME[sub.provider] && (
        <p className="text-sm text-ink-3">
          Change or cancel it in {STORE_NAME[sub.provider]}, on the phone you paid with.
        </p>
      )}
    </section>
  );
}

function Trial({ id, b }: { id: string; b: BusinessBilling }) {
  const refresh = useRefresh(id);
  const [busy, setBusy] = useState(false);
  const { days, plan } = b.trial;
  if (!plan || !days) return null;
  const start = async () => {
    setBusy(true);
    try {
      await startTrial(id);
      toast.success(`Your ${plan.name} trial has started.`);
      await refresh();
    } catch (err) {
      toast.error(problem(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-labelledby="trial"
      className="flex flex-col gap-4 rounded-xl bg-brand-soft p-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <h2 id="trial" className="text-lg font-semibold">
          Try {plan.name} free for {days} days
        </h2>
        <p className="text-sm text-ink-2">
          Everything in {plan.name}, with no card. When it ends you’re back on the free plan; nothing is
          deleted. Once per business.
        </p>
      </div>
      <Button variant="primary" loading={busy} onClick={() => void start()} className="shrink-0">
        Start the free trial
      </Button>
    </section>
  );
}

const TONE: Record<Tone, { fill: string; track: string }> = {
  ok: { fill: 'bg-ok', track: 'bg-ok-soft' },
  wait: { fill: 'bg-wait', track: 'bg-wait-soft' },
  danger: { fill: 'bg-danger', track: 'bg-danger-soft' },
};

/** Each limit as a meter (the track a lighter step of the fill's colour), and each feature, in or out. */
function UsageCard({ b, pricing }: { b: BusinessBilling; pricing: Pricing }) {
  const labels = new Map(pricing.comparison.limits.map((l) => [l.key, l.label]));
  const featureLabels = pricing.comparison.features;
  const limits = Object.entries(b.usage);
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold tracking-[-0.015em]">What you use</h2>
        <CardDescription>
          Over a limit, nothing is removed; only adding more waits until you choose a bigger plan.
        </CardDescription>
      </CardHeader>
      <CardBody className="grid gap-8 lg:grid-cols-2">
        <ul aria-label="Limits" className="flex flex-col gap-5">
          {limits.map(([key, u]) => {
            const m = meter(u);
            return (
              <li key={key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-ink">{labels.get(key) ?? key}</span>
                  <span className="text-ink-2 tabular-nums">{m.text}</span>
                </div>
                {m.share !== null && (
                  <span
                    aria-hidden
                    className={cn('block h-2 overflow-hidden rounded-full', TONE[m.tone].track)}
                  >
                    <span
                      className={cn('block h-full rounded-full', TONE[m.tone].fill)}
                      style={{ width: `${Math.max(m.share * 100, u.used ? 2 : 0)}%` }}
                    />
                  </span>
                )}
                {m.state && (
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-xs font-medium',
                      m.tone === 'danger' ? 'text-danger' : 'text-wait-ink',
                    )}
                  >
                    <AlertTriangle aria-hidden className="size-3.5" />
                    {m.state}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {featureLabels.length > 0 && (
          <ul aria-label="Features" className="flex flex-col gap-3 text-sm">
            {featureLabels.map((f) => {
              const on = everythingIncluded(b) || b.features[f.key] === true;
              return (
                <li key={f.key} className="flex items-start gap-2.5">
                  {on ? (
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
                  ) : (
                    <Minus aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  )}
                  <span className={on ? 'text-ink' : 'text-ink-3'}>
                    {f.label}
                    <span className="sr-only">{on ? ': included' : ': not in this plan'}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Plans({
  id,
  b,
  pricing,
  owner,
}: {
  id: string;
  b: BusinessBilling;
  pricing: Pricing;
  owner: boolean;
}) {
  const refresh = useRefresh(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const included = everythingIncluded(b);

  const buy = async (code: string) => {
    setBusy(code);
    try {
      const started = await checkout(id, code);
      const url = safePaymentUrl(started.checkoutUrl, window.location.origin);
      if (!url) throw new Error('unexpected link');
      window.location.assign(url);
    } catch (err) {
      toast.error(problem(err));
      setBusy(null);
    }
  };
  const change = async (code: string, name: string) => {
    setBusy(code);
    try {
      await changePlan(id, code);
      setSwitching(null);
      toast.success(`You’re on ${name} now.`);
      await refresh();
    } catch (err) {
      toast.error(problem(err));
    } finally {
      setBusy(null);
    }
  };

  const action = (plan: Pricing['plans'][number]): ReactNode => {
    switch (planAction(plan, b, owner)) {
      case 'current':
        return <Badge tone="brand">Your plan</Badge>;
      case 'checkout':
        return (
          <Button variant="primary" block loading={busy === plan.code} onClick={() => void buy(plan.code)}>
            Choose {plan.name}
          </Button>
        );
      case 'change':
        return switching === plan.code ? (
          <div className="flex flex-col gap-2 rounded-md bg-sunken p-3 text-sm">
            <span className="text-ink-2">Switch now? The difference is charged or credited today.</span>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={busy === plan.code}
                onClick={() => void change(plan.code, plan.name)}
              >
                Switch to {plan.name}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSwitching(null)}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" block onClick={() => setSwitching(plan.code)}>
            Switch to {plan.name}
          </Button>
        );
      case 'store':
        return <p className="text-sm text-ink-3">Change it in the store you pay through.</p>;
      default:
        return null;
    }
  };

  return (
    <section aria-labelledby="plans" className="flex flex-col gap-6">
      <SectionHeading
        id="plans"
        size="heading"
        title="Plans"
        description={
          included
            ? 'BUKU isn’t charging businesses yet. These are the plans for when it does.'
            : owner
              ? 'Pay by card, monthly. Change or cancel whenever you like.'
              : 'Only the owner can change the plan.'
        }
      />
      {/* Four plans: two by two, or one row where four fit. */}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {pricing.plans.map((plan) => (
          <div key={plan.code} className="flex flex-col gap-3">
            <PlanCard
              plan={plan}
              trial={b.trial.available ? pricing.trial : null}
              highlight={!included && plan.code === b.plan.code}
            />
            {action(plan)}
          </div>
        ))}
      </div>
      <ComparisonTable pricing={pricing} />
    </section>
  );
}

function Requests({
  id,
  pricing,
  requests,
  owner,
  day,
}: {
  id: string;
  pricing: Pricing;
  requests: PlanRequest[];
  owner: boolean;
  day: (iso: string) => string;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooShort, setTooShort] = useState<string | null>(null);
  const pending = requests.find((r) => r.status === 'pending') ?? null;
  const past = requests.filter((r) => r.status !== 'pending');
  const paid = pricing.plans.filter((p) => !p.free);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: planRequestsKey(id) }),
      queryClient.invalidateQueries({ queryKey: billingKey(id) }),
    ]);

  const send = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const planCode = text('plan');
    const raw = text('message').trim();
    const message = MESSAGE.safeParse(raw);
    if (raw.length < 10 || !message.success) {
      setTooShort(
        raw.length < 10
          ? 'Tell BUKU a little more: at least 10 characters.'
          : (message.error?.issues[0]?.message ?? 'Please check the text.'),
      );
      return;
    }
    setTooShort(null);
    setBusy(true);
    setError(null);
    try {
      await askForPlan(id, planCode, message.data);
      toast.success('Sent. BUKU will reply here.');
      await refresh();
    } catch (err) {
      setError(problem(err));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (requestId: string) => {
    setBusy(true);
    try {
      await withdrawRequest(id, requestId);
      toast.success('Request withdrawn.');
      await refresh();
    } catch (err) {
      toast.error(problem(err));
    } finally {
      setBusy(false);
    }
  };

  if (!owner && requests.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold tracking-[-0.015em]">Ask BUKU for a plan</h2>
        <CardDescription>
          For a group with many branches, a non-profit, or anything the plans don’t fit. BUKU reads every
          request.
        </CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-6">
        {pending ? (
          <div className="flex flex-col gap-3 rounded-md bg-sunken p-4 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{pending.plan.name}</span>
              <Badge tone="wait">{REQUEST_STATUS.pending}</Badge>
              <span className="text-ink-3">Asked on {day(pending.createdAt)}</span>
            </p>
            <p className="whitespace-pre-line text-ink-2">{pending.message}</p>
            {owner && (
              <Button
                variant="secondary"
                size="sm"
                className="w-fit"
                loading={busy}
                onClick={() => void withdraw(pending.id)}
              >
                Withdraw the request
              </Button>
            )}
          </div>
        ) : owner && paid.length > 0 ? (
          <form onSubmit={(e) => void send(e)} className="flex flex-col gap-4">
            <Field label="Which plan" required>
              <Select name="plan" required defaultValue={paid.at(-1)?.code}>
                {paid.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Tell BUKU about the business"
              hint="Who you are and why, for example: a hospital group with 14 branches."
              required
              error={tooShort ?? undefined}
            >
              <Textarea name="message" required maxLength={1000} rows={4} />
            </Field>
            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" className="w-fit" loading={busy}>
              Send the request
            </Button>
          </form>
        ) : null}
        {past.length > 0 && (
          <ul aria-label="Earlier requests" className="flex flex-col divide-y divide-line text-sm">
            {past.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.plan.name}</span>
                  <Badge
                    tone={r.status === 'approved' ? 'ok' : r.status === 'declined' ? 'danger' : 'neutral'}
                  >
                    {REQUEST_STATUS[r.status]}
                  </Badge>
                  <span className="text-ink-3">{day(r.decidedAt ?? r.createdAt)}</span>
                </p>
                {r.decisionNote && <p className="text-ink-2">BUKU: {r.decisionNote}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

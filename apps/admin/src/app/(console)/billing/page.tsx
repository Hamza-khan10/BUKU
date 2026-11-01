import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Receipt, Inbox } from 'lucide-react';
import { ApproveRequest } from '@admin/components/approve-request';
import { BillingSettings } from '@admin/components/billing-settings';
import { Empty } from '@admin/components/empty';
import { GivePlan } from '@admin/components/give-plan';
import { NewPrice } from '@admin/components/new-price';
import { RowActions } from '@admin/components/row-actions';
import { Tabs } from '@admin/components/tabs';
import { Card, Initials, Notice, PageTitle, Pill, SectionTitle, beat } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import {
  CHANNELS,
  SOURCE,
  type Plan,
  type PlanRequest,
  type Settings,
  type Subscription,
} from '@admin/lib/billing';
import { callApi } from '@admin/lib/gateway';

export const metadata: Metadata = { title: 'Billing' };

const VIEWS = [
  { value: 'requests', label: 'Plan requests' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'plans', label: 'Plans and prices' },
] as const;
const REQUEST_STATUSES = [
  { value: 'pending', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'withdrawn', label: 'Withdrawn' },
] as const;
const SUBSCRIPTION_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'trialing', label: 'Trials' },
  { value: 'past_due', label: 'Payment due' },
  { value: 'cancelled', label: 'Ended' },
] as const;

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

/**
 * Billing for operators (3.6h): businesses' plan requests (approve, perhaps another plan or until a
 * date; or decline) and every business's subscription (paid, given or a trial), with a plan to give
 * and a way to end one. Plans, prices and the economics come next.
 */
export default async function BillingPage({ searchParams }: PageProps<'/billing'>) {
  const gate = await requireAdmin('/billing');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const query = await searchParams;
  const view = VIEWS.find((v) => v.value === query.view)?.value ?? 'requests';
  const call = <T,>(path: string) =>
    callApi<T>({ path, accessToken: gate.accessToken, incoming: gate.incoming, requestId: gate.requestId });
  const plans = await call<Plan[]>('/v1/admin/billing/plans');
  const businessPlans = plans.ok
    ? plans.data
        .filter((p) => p.audience === 'business' && !p.archivedAt)
        .map((p) => ({ code: p.code, name: p.name }))
    : [];

  return (
    <>
      <PageTitle
        title="Billing"
        description="What businesses asked for, and the plan each one is on: paid, given by an admin, or a free trial. Every decision is recorded."
      />
      <Tabs
        label="Billing"
        items={VIEWS.map((v) => ({
          href: `/billing?view=${v.value}` as Route,
          label: v.label,
          current: v.value === view,
        }))}
      />
      {view === 'requests' ? (
        <Requests status={query.status} call={call} plans={businessPlans} />
      ) : view === 'subscriptions' ? (
        <Subscriptions status={query.status} page={query.page} call={call} plans={businessPlans} />
      ) : !plans.ok ? (
        <Notice tone="danger" title={plans.error.message} />
      ) : (
        <Plans plans={plans.data} call={call} />
      )}
    </>
  );
}

type Call = <T>(path: string) => ReturnType<typeof callApi<T>>;

async function Requests({
  status: asked,
  call,
  plans,
}: {
  status: string | string[] | undefined;
  call: Call;
  plans: { code: string; name: string }[];
}) {
  const status = REQUEST_STATUSES.find((s) => s.value === asked)?.value ?? 'pending';
  const list = await call<PlanRequest[]>(`/v1/admin/billing/plan-requests?status=${status}`);
  return (
    <>
      <div>
        <Tabs
          label="By status"
          items={REQUEST_STATUSES.map((s) => ({
            href: `/billing?view=requests&status=${s.value}` as Route,
            label: s.label,
            current: s.value === status,
          }))}
        />
      </div>
      {!list.ok ? (
        <Notice tone="danger" title={list.error.message} />
      ) : list.data.length === 0 ? (
        <Empty
          icon={Inbox}
          title="Nothing here"
          text={status === 'pending' ? 'No business is waiting for an answer.' : 'No request in this list.'}
        />
      ) : (
        <ul aria-label="Plan requests" className="flex flex-col gap-3">
          {list.data.map((r, i) => (
            <li
              key={r.id}
              style={beat(i + 1)}
              className="panel rise flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"
            >
              <div className="flex min-w-0 gap-3">
                <Initials name={r.business.name} />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    {r.business.name}
                    <Pill tone="brand">{r.plan.name}</Pill>
                  </p>
                  <p className="max-w-prose text-sm text-ink">“{r.message}”</p>
                  <p className="text-xs text-ink-3">
                    {r.business.city}, {r.business.country} ·{' '}
                    <span className="font-mono">{r.business.id}</span> · asked {day(r.createdAt)}
                  </p>
                  {r.status !== 'pending' && (
                    <p className="text-xs text-ink-2">
                      {r.status === 'approved'
                        ? 'Approved'
                        : r.status === 'declined'
                          ? 'Declined'
                          : 'Withdrawn'}
                      {r.decidedAt && <> {day(r.decidedAt)}</>}
                      {r.decisionNote && <> · “{r.decisionNote}”</>}
                    </p>
                  )}
                </div>
              </div>
              {r.status === 'pending' && (
                <div className="flex flex-col items-end gap-2">
                  <ApproveRequest id={r.id} subject={r.business.name} asked={r.plan.code} plans={plans} />
                  <RowActions
                    subject={`${r.business.name}’s request`}
                    actions={[
                      {
                        path: `/api/billing/requests/${r.id}/decline`,
                        label: 'Decline',
                        tone: 'danger-quiet',
                        reason: 'Why decline? The business sees this note.',
                        reasonMax: 500,
                      },
                    ]}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

async function Subscriptions({
  status: asked,
  page: askedPage,
  call,
  plans,
}: {
  status: string | string[] | undefined;
  page: string | string[] | undefined;
  call: Call;
  plans: { code: string; name: string }[];
}) {
  const status = SUBSCRIPTION_STATUSES.find((s) => s.value === asked)?.value ?? 'active';
  const page = Math.max(1, Math.min(10_000, Number(askedPage) || 1));
  const list = await call<Subscription[]>(
    `/v1/admin/billing/subscriptions?status=${status}&page=${page}&limit=25`,
  );
  return (
    <div className="flex flex-col gap-8">
      <Card
        title="Give a business a plan"
        description="Free of charge: a launch partner, a pilot, a way to say sorry. It ends on the date you set, or when an admin ends it."
        className="rise"
      >
        <GivePlan plans={plans} />
      </Card>
      <div>
        <Tabs
          label="By status"
          items={SUBSCRIPTION_STATUSES.map((s) => ({
            href: `/billing?view=subscriptions&status=${s.value}` as Route,
            label: s.label,
            current: s.value === status,
          }))}
        />
        {!list.ok ? (
          <Notice tone="danger" title={list.error.message} />
        ) : list.data.length === 0 ? (
          <Empty icon={Receipt} title="Nothing here" text="No subscription in this list." />
        ) : (
          <div className="panel rise overflow-x-auto">
            <table className="data-table min-w-[52rem]">
              <caption className="sr-only">Subscriptions</caption>
              <thead>
                <tr>
                  <th scope="col">Business</th>
                  <th scope="col">Plan</th>
                  <th scope="col">How</th>
                  <th scope="col">Until</th>
                  <th scope="col" className="text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((s) => {
                  const live = ['active', 'trialing', 'past_due', 'paused'].includes(s.status);
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Initials name={s.businessName ?? s.businessId} />
                          <div className="min-w-0">
                            <p className="font-medium text-ink">{s.businessName ?? 'A business'}</p>
                            <p className="font-mono text-xs text-ink-3">{s.businessId}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Pill tone="brand">{s.plan.name}</Pill>
                      </td>
                      <td className="text-ink-2">
                        {SOURCE[s.provider] ?? s.provider}
                        {s.grantNote && (
                          <p className="max-w-xs truncate text-xs text-ink-3">“{s.grantNote}”</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-ink-2 tabular-nums">
                        {s.status === 'cancelled' && s.cancelledAt
                          ? `Ended ${day(s.cancelledAt)}`
                          : s.currentPeriodEnd
                            ? day(s.currentPeriodEnd)
                            : 'For good'}
                      </td>
                      <td>
                        {live && (
                          <RowActions
                            subject={`${s.businessName ?? s.businessId}’s ${s.plan.name}`}
                            actions={[
                              {
                                path: `/api/billing/subscriptions/${s.id}/end`,
                                label: 'End now',
                                tone: 'danger-quiet',
                                reason:
                                  s.provider === 'paddle'
                                    ? 'Why end it? It’s cancelled in Paddle at once and they stop paying.'
                                    : 'Why end it? They go back to the free plan.',
                                reasonMax: 300,
                              },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.ok && list.meta && list.meta.totalPages > 1 && (
          <nav aria-label="Pages" className="mt-5 flex items-center justify-between text-sm text-ink-3">
            <span className="tabular-nums">
              Page {list.meta.page} of {list.meta.totalPages} · {list.meta.total} in all
            </span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link
                  className="font-medium text-ink hover:underline"
                  href={`/billing?view=subscriptions&status=${status}&page=${page - 1}` as Route}
                >
                  Previous
                </Link>
              )}
              {page < list.meta.totalPages && (
                <Link
                  className="font-medium text-ink hover:underline"
                  href={`/billing?view=subscriptions&status=${status}&page=${page + 1}` as Route}
                >
                  Next
                </Link>
              )}
            </span>
          </nav>
        )}
      </div>
    </div>
  );
}

interface Comparison {
  comparison: { limits: { key: string; label: string }[]; features: { key: string; label: string }[] };
}

async function Plans({ plans, call }: { plans: Plan[]; call: Call }) {
  const [settings, labels] = await Promise.all([
    call<Settings[]>('/v1/admin/billing/settings'),
    call<Comparison>('/v1/billing/plans?audience=business&channel=web'),
  ]);
  const business = settings.ok ? settings.data.find((s) => s.audience === 'business') : undefined;
  const sellable = plans
    .filter((p) => p.audience === 'business' && !p.archivedAt)
    .map((p) => ({ code: p.code, name: p.name }));
  const limitLabel = new Map(labels.ok ? labels.data.comparison.limits.map((l) => [l.key, l.label]) : []);
  const featureLabel = new Map(labels.ok ? labels.data.comparison.features.map((f) => [f.key, f.label]) : []);
  const businessPlans = plans.filter((p) => p.audience === 'business');
  const customerPlans = plans.filter((p) => p.audience === 'user');

  return (
    <div className="flex flex-col gap-8">
      <Card
        title="Billing for businesses"
        description="Whether businesses are charged, the plans they fall back to, and the free trial. Each change is recorded."
        className="rise"
      >
        {business ? (
          <BillingSettings settings={business} plans={sellable} />
        ) : (
          <Notice
            tone="danger"
            title={
              settings.ok ? 'No settings found: everyone is treated as unlimited.' : settings.error.message
            }
          />
        )}
      </Card>

      <section aria-labelledby="business-plans" className="flex flex-col gap-4">
        <SectionTitle
          id="business-plans"
          title="Business plans"
          description="What each plan includes and what it costs where. A new price is for new customers; subscribers keep theirs."
        />
        <ul aria-label="Business plans" className="grid gap-4 xl:grid-cols-2">
          {businessPlans.map((p, i) => (
            <PlanCard key={p.code} plan={p} i={i} limitLabel={limitLabel} featureLabel={featureLabel} />
          ))}
        </ul>
      </section>

      {customerPlans.length > 0 && (
        <Notice title="Customer plans are kept but unused">
          Customers use BUKU for free (D-101): their plans ({customerPlans.map((p) => p.name).join(', ')})
          stay in the catalogue and charging can’t be turned on for them.
        </Notice>
      )}
    </div>
  );
}

function PlanCard({
  plan: p,
  i,
  limitLabel,
  featureLabel,
}: {
  plan: Plan;
  i: number;
  limitLabel: Map<string, string>;
  featureLabel: Map<string, string>;
}) {
  const live = p.prices.filter((x) => x.active);
  const old = p.prices.length - live.length;
  return (
    <li
      style={beat(i + 1)}
      className={`panel rise flex flex-col gap-4 p-5 ${p.archivedAt ? 'opacity-80' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-[-0.01em] text-ink">
            {p.name}
            <span className="font-mono text-xs font-normal text-ink-3">{p.code}</span>
          </p>
          {p.tagline && <p className="text-sm text-ink-2">{p.tagline}</p>}
          <p className="flex flex-wrap gap-1.5 pt-1">
            {p.archivedAt ? (
              <Pill tone="danger">Not sold</Pill>
            ) : p.isPublic ? (
              <Pill tone="ok">On the pricing page</Pill>
            ) : (
              <Pill>Hidden</Pill>
            )}
            {p.usedAs.map((u) => (
              <Pill key={u} tone="brand">
                {u}
              </Pill>
            ))}
          </p>
        </div>
        <p className="text-right">
          <span className="block text-2xl leading-none font-semibold tabular-nums">{p.subscribers}</span>
          <span className="text-xs text-ink-3">
            {p.subscribers === 1 ? 'business on it' : 'businesses on it'}
          </span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-3">Includes</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(p.limits).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="text-ink-2">{limitLabel.get(k) ?? k.replaceAll('_', ' ')}</span>
                <span className="font-medium text-ink tabular-nums">{v === null ? 'Unlimited' : v}</span>
              </li>
            ))}
            {Object.entries(p.features).map(([k, on]) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="text-ink-2">{featureLabel.get(k) ?? k.replaceAll('_', ' ')}</span>
                <span className={on ? 'font-medium text-ok' : 'text-ink-3'}>{on ? 'Yes' : 'No'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-3">Prices</h3>
          {live.length === 0 ? (
            <p className="text-sm text-ink-3">Free: no price.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {live.map((x) => (
                <li
                  key={x.id}
                  className="flex flex-col gap-1.5 rounded-lg bg-sunken/60 px-3 py-2 ring-1 ring-line ring-inset"
                >
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-2">{CHANNELS[x.channel]}</span>
                    <span className="font-semibold text-ink tabular-nums">
                      {x.currency} {x.amount}
                      <span className="font-normal text-ink-3"> / {x.interval}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    {x.channel === 'web' ? (
                      x.externalPriceId ? (
                        <span className="truncate font-mono text-[0.7rem] text-ink-3">
                          Paddle {x.externalPriceId}
                        </span>
                      ) : (
                        <span className="text-xs text-wait">Not in Paddle yet</span>
                      )
                    ) : (
                      <span className="text-xs text-ink-3">
                        {x.externalPriceId ? `Store ${x.externalPriceId}` : 'Not linked to the store'}
                      </span>
                    )}
                    <RowActions
                      subject={`${p.name} on ${CHANNELS[x.channel]}`}
                      actions={[
                        ...(x.channel === 'web' && !x.externalPriceId
                          ? [
                              {
                                path: `/api/billing/prices/${x.id}/sync-paddle` as const,
                                label: 'Create in Paddle',
                                tone: 'secondary' as const,
                              },
                            ]
                          : []),
                        {
                          path: `/api/billing/prices/${x.id}/archive` as const,
                          label: 'Stop selling',
                          tone: 'danger-quiet' as const,
                          confirm:
                            'Stop selling at this price on this channel? Subscribers keep paying it; new customers need a new price.',
                        },
                      ]}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {old > 0 && (
            <p className="text-xs text-ink-3">
              {old} earlier {old === 1 ? 'price' : 'prices'}, kept for subscribers who agreed to them.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4">
        {!p.archivedAt && <NewPrice code={p.code} name={p.name} />}
        <RowActions
          subject={p.name}
          actions={[
            p.archivedAt
              ? { path: `/api/billing/plans/${p.code}/restore`, label: 'Sell it again', tone: 'primary' }
              : {
                  path: `/api/billing/plans/${p.code}/archive`,
                  label: 'Stop selling the plan',
                  tone: 'danger-quiet',
                  confirm: 'Stop selling this plan? New businesses can’t choose it; those on it keep it.',
                },
          ]}
        />
      </div>
    </li>
  );
}

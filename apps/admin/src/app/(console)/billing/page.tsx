import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Receipt, Inbox } from 'lucide-react';
import { ApproveRequest } from '@admin/components/approve-request';
import { Empty } from '@admin/components/empty';
import { GivePlan } from '@admin/components/give-plan';
import { RowActions } from '@admin/components/row-actions';
import { Tabs } from '@admin/components/tabs';
import { Card, Initials, Notice, PageTitle, Pill, beat } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { SOURCE, type Plan, type PlanRequest, type Subscription } from '@admin/lib/billing';
import { callApi } from '@admin/lib/gateway';

export const metadata: Metadata = { title: 'Billing' };

const VIEWS = [
  { value: 'requests', label: 'Plan requests' },
  { value: 'subscriptions', label: 'Subscriptions' },
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
      ) : (
        <Subscriptions status={query.status} page={query.page} call={call} plans={businessPlans} />
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

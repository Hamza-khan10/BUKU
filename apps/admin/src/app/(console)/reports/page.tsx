import type { Metadata, Route } from 'next';
import { RowActions } from '@admin/components/row-actions';
import { FlagOff } from 'lucide-react';
import { Empty } from '@admin/components/empty';
import { Tabs } from '@admin/components/tabs';
import { Initials, Notice, PageTitle, Pill, beat } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';

export const metadata: Metadata = { title: 'Reports' };

type Status = 'open' | 'reviewed' | 'dismissed';
const STATUSES: { value: Status; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Looked into' },
  { value: 'dismissed', label: 'Dismissed' },
];

interface Report {
  id: string;
  reason: string;
  details: string | null;
  status: Status;
  createdAt: string;
  reviewedAt: string | null;
  business: { id: string; name: string; slug: string; status: string };
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso)) + ' UTC';

/**
 * What people reported about businesses (3.6b), oldest first. Looking into one may lead to
 * suspending the business (Businesses); closing the report records the outcome.
 */
export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const gate = await requireAdmin('/reports');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const query = await searchParams;
  const status = STATUSES.find((s) => s.value === query.status)?.value ?? 'open';
  const list = await callApi<Report[]>({
    path: `/v1/admin/business-reports?status=${status}&limit=50`,
    accessToken: gate.accessToken,
    incoming: gate.incoming,
    requestId: gate.requestId,
  });

  return (
    <>
      <PageTitle
        title="Reports"
        description="What customers reported about businesses. Look into each; suspend the business from Businesses if it breaks the rules, then close the report."
      />
      <Tabs
        label="By status"
        items={STATUSES.map((s) => ({
          href: `/reports?status=${s.value}` as Route,
          label: s.label,
          current: s.value === status,
        }))}
      />
      {!list.ok ? (
        <Notice tone="danger" title={list.error.message} />
      ) : list.data.length === 0 ? (
        <Empty
          icon={FlagOff}
          title="Nothing here"
          text={status === 'open' ? 'No report is waiting.' : 'No report in this list.'}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.map((r, i) => (
            <li
              key={r.id}
              style={beat(i + 1)}
              className="panel rise flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"
            >
              <div className="flex min-w-0 gap-3">
                <Initials name={r.business.name} />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {r.business.name}
                    <Pill tone={r.business.status === 'suspended' ? 'danger' : 'neutral'}>
                      {r.business.status}
                    </Pill>
                  </p>
                  <p className="text-sm text-ink-2">
                    <span className="inline-flex items-center rounded-md bg-wait-soft px-1.5 py-0.5 text-xs font-semibold text-wait">
                      {r.reason.replaceAll('_', ' ')}
                    </span>
                    {r.details && <span className="ml-2">“{r.details}”</span>}
                  </p>
                  <p className="text-xs text-ink-3">
                    Reported {when(r.createdAt)} · <span className="font-mono">{r.business.id}</span>
                  </p>
                </div>
              </div>
              {r.status === 'open' && (
                <RowActions
                  subject={`report about ${r.business.name}`}
                  actions={[
                    {
                      path: `/api/reports/${r.id}/resolve`,
                      label: 'Looked into',
                      tone: 'primary',
                      body: { status: 'reviewed' },
                    },
                    { path: `/api/reports/${r.id}/resolve`, label: 'Dismiss', body: { status: 'dismissed' } },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

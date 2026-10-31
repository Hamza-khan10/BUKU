import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { RowActions } from '@admin/components/row-actions';
import { Notice, PageTitle, Pill } from '@admin/components/ui';
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
      <nav aria-label="By status" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            href={`/reports?status=${s.value}` as Route}
            aria-current={s.value === status ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              s.value === status ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {!list.ok ? (
        <Notice tone="danger" title={list.error.message} />
      ) : list.data.length === 0 ? (
        <Notice tone="ok" title="Nothing here">
          {status === 'open' ? 'No report is waiting.' : 'No report in this list.'}
        </Notice>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium text-ink">
                  {r.business.name}{' '}
                  <Pill tone={r.business.status === 'suspended' ? 'danger' : 'neutral'}>
                    {r.business.status}
                  </Pill>
                </p>
                <p className="text-sm text-ink-2">
                  <span className="font-medium">{r.reason.replaceAll('_', ' ')}</span>
                  {r.details && <> — “{r.details}”</>}
                </p>
                <p className="text-xs text-ink-3">
                  Reported {when(r.createdAt)} · <span className="font-mono">{r.business.id}</span>
                </p>
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

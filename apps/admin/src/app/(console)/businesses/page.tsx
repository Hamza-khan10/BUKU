import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { RowActions, type RowAction } from '@admin/components/row-actions';
import { Empty } from '@admin/components/empty';
import { Tabs } from '@admin/components/tabs';
import { Initials, Notice, PageTitle, Pill, beat } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';

export const metadata: Metadata = { title: 'Businesses' };

type Status = 'pending' | 'verified' | 'suspended' | 'rejected';
const STATUSES: { value: Status; label: string }[] = [
  { value: 'pending', label: 'To verify' },
  { value: 'verified', label: 'Verified' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Not approved' },
];

interface AdminBusiness {
  id: string;
  slug: string;
  name: string;
  city: string;
  country: string;
  status: Status;
  rejectionReason: string | null;
  createdAt: string;
  category: { name: string | null };
  owner: { id: string; name: string } | null;
  openReports: number;
}

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

/** The steps each status allows (the API's own: verify and reject from pending; suspend; reinstate). */
function actionsFor(b: AdminBusiness): RowAction[] {
  const base = `/api/businesses/${b.id}` as const;
  const suspend: RowAction = {
    path: `${base}/suspend`,
    label: 'Suspend',
    tone: 'danger-quiet',
    reason: 'Why suspend it? The owner is told, and it disappears from search and booking.',
  };
  if (b.status === 'pending')
    return [
      { path: `${base}/verify`, label: 'Verify', tone: 'primary' },
      {
        path: `${base}/reject`,
        label: 'Reject',
        tone: 'secondary',
        reason: 'Why isn’t it approved? The owner is told.',
      },
      suspend,
    ];
  if (b.status === 'verified' || b.status === 'rejected') return [suspend];
  return [{ path: `${base}/reinstate`, label: 'Reinstate', tone: 'primary' }];
}

/**
 * Every business by where it stands (3.6b): the ones waiting to be verified first, oldest first.
 * Verifying needs what the verification checklist asks for; the API says what's missing.
 */
export default async function BusinessesPage({ searchParams }: PageProps<'/businesses'>) {
  const gate = await requireAdmin('/businesses');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const query = await searchParams;
  const status = STATUSES.find((s) => s.value === query.status)?.value ?? 'pending';
  const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
  const list = await callApi<AdminBusiness[]>({
    path: `/v1/admin/businesses?status=${status}&page=${page}&limit=25`,
    accessToken: gate.accessToken,
    incoming: gate.incoming,
    requestId: gate.requestId,
  });

  const label = STATUSES.find((s) => s.value === status)?.label;
  return (
    <>
      <PageTitle
        title="Businesses"
        description="Verify new businesses, and suspend one that breaks the rules. The owner is told each time, and every step is recorded in the audit log."
      />
      <Tabs
        label="By status"
        items={STATUSES.map((s) => ({
          href: `/businesses?status=${s.value}` as Route,
          label: s.label,
          current: s.value === status,
        }))}
      />
      {!list.ok ? (
        <Notice tone="danger" title={list.error.message}>
          {list.requestId && <span className="font-mono text-xs">Reference: {list.requestId}</span>}
        </Notice>
      ) : list.data.length === 0 ? (
        <Empty
          title="Nothing here"
          text={`No business is ${label?.toLowerCase() === 'to verify' ? 'waiting to be verified' : `in “${label}”`} right now.`}
        />
      ) : (
        <>
          <div className="panel rise overflow-x-auto" style={beat(1)}>
            <table className="data-table min-w-[48rem]">
              <caption className="sr-only">Businesses: {label}</caption>
              <thead>
                <tr>
                  <th scope="col">Business</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Since</th>
                  <th scope="col">Reports</th>
                  <th scope="col" className="text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Initials name={b.name} />
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{b.name}</p>
                          <p className="text-xs text-ink-3">
                            {b.category.name ?? 'Uncategorised'} · {b.city}, {b.country} ·{' '}
                            <span className="font-mono">{b.id}</span>
                          </p>
                          {b.rejectionReason && (
                            <p className="mt-1 text-xs text-wait">“{b.rejectionReason}”</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-ink-2">{b.owner?.name ?? '—'}</td>
                    <td className="whitespace-nowrap text-ink-2 tabular-nums">{day(b.createdAt)}</td>
                    <td>
                      {b.openReports > 0 ? (
                        <Pill tone="danger">{b.openReports} open</Pill>
                      ) : (
                        <span className="text-ink-3">None</span>
                      )}
                    </td>
                    <td>
                      <RowActions subject={b.name} actions={actionsFor(b)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.meta && list.meta.totalPages > 1 && (
            <nav aria-label="Pages" className="mt-5 flex items-center justify-between text-sm text-ink-3">
              <span className="tabular-nums">
                Page {list.meta.page} of {list.meta.totalPages} · {list.meta.total} in all
              </span>
              <span className="flex gap-2">
                {page > 1 && (
                  <Link
                    className="press inline-flex h-8 items-center rounded-lg px-3 font-medium text-ink ring-1 ring-line-strong ring-inset hover:bg-raised"
                    href={`/businesses?status=${status}&page=${page - 1}` as Route}
                  >
                    Previous
                  </Link>
                )}
                {page < list.meta.totalPages && (
                  <Link
                    className="press inline-flex h-8 items-center rounded-lg px-3 font-medium text-ink ring-1 ring-line-strong ring-inset hover:bg-raised"
                    href={`/businesses?status=${status}&page=${page + 1}` as Route}
                  >
                    Next
                  </Link>
                )}
              </span>
            </nav>
          )}
        </>
      )}
    </>
  );
}

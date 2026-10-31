import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { RowActions, type RowAction } from '@admin/components/row-actions';
import { Notice, PageTitle, Pill } from '@admin/components/ui';
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
    tone: 'danger',
    reason: 'Why suspend it? The owner is told, and it disappears from search and booking.',
  };
  if (b.status === 'pending')
    return [
      { path: `${base}/verify`, label: 'Verify', tone: 'primary' },
      {
        path: `${base}/reject`,
        label: 'Reject',
        tone: 'danger',
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

  return (
    <>
      <PageTitle
        title="Businesses"
        description="Verify new businesses, and suspend one that breaks the rules. The owner is told each time, and every step is recorded in the audit log."
      />
      <nav aria-label="By status" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            href={`/businesses?status=${s.value}` as Route}
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
        <Notice tone="danger" title={list.error.message}>
          {list.requestId && <span className="font-mono text-xs">Reference: {list.requestId}</span>}
        </Notice>
      ) : list.data.length === 0 ? (
        <Notice title="Nothing here">No business is in this list right now.</Notice>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <caption className="sr-only">
                Businesses: {STATUSES.find((s) => s.value === status)?.label}
              </caption>
              <thead className="border-b border-line text-xs tracking-wide text-ink-3 uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Business
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Owner
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Since
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Reports
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{b.name}</p>
                      <p className="text-xs text-ink-3">
                        {b.category.name ?? 'Uncategorised'} · {b.city}, {b.country} ·{' '}
                        <span className="font-mono">{b.id}</span>
                      </p>
                      {b.rejectionReason && <p className="mt-1 text-xs text-wait">“{b.rejectionReason}”</p>}
                    </td>
                    <td className="px-4 py-3 text-ink-2">{b.owner?.name ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-2">{day(b.createdAt)}</td>
                    <td className="px-4 py-3">
                      {b.openReports > 0 ? (
                        <Pill tone="danger">{b.openReports} open</Pill>
                      ) : (
                        <span className="text-ink-3">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RowActions subject={b.name} actions={actionsFor(b)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.meta && list.meta.totalPages > 1 && (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm text-ink-3">
              <span>
                Page {list.meta.page} of {list.meta.totalPages} · {list.meta.total} in all
              </span>
              <span className="flex gap-2">
                {page > 1 && (
                  <Link className="underline" href={`/businesses?status=${status}&page=${page - 1}` as Route}>
                    Previous
                  </Link>
                )}
                {page < list.meta.totalPages && (
                  <Link className="underline" href={`/businesses?status=${status}&page=${page + 1}` as Route}>
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

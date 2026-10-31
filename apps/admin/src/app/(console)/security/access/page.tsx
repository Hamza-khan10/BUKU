import type { Metadata } from 'next';
import { Card, Initials, Notice, PageTitle, Pill } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';

export const metadata: Metadata = { title: 'Access review' };

interface AccessReport {
  generatedAt: string;
  platformAdmins: {
    id: string;
    name: string;
    email: string | null;
    status: string;
    lastActive: string | null;
    mfa: boolean;
    dormant: boolean;
  }[];
  businessAccess: { owners: number; teamMembers: Record<string, number>; employeeAccounts: number };
}

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(iso)) + ' UTC'
    : 'Never';

/**
 * Who holds platform admin access, whether they use two-step sign-in, and who
 * has gone quiet (SOC 2 access review, D-080).
 * Producing it is itself recorded in the audit log.
 */
export default async function AccessReviewPage() {
  const gate = await requireAdmin('/security/access');
  if (gate.kind === 'unavailable') {
    return (
      <Notice tone="danger" title={gate.message}>
        {gate.reference && <span className="font-mono text-xs">Reference: {gate.reference}</span>}
      </Notice>
    );
  }
  const report = await callApi<AccessReport>({
    path: '/v1/admin/access-review',
    accessToken: gate.accessToken,
    incoming: gate.incoming,
    requestId: gate.requestId,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Access review"
        description="Who holds platform admin access, whether they use two-step sign-in, and who has gone quiet. Producing it is recorded in the audit log."
      />
      {!report.ok ? (
        <Notice
          tone="danger"
          title={
            report.error.code === 'MFA_REQUIRED'
              ? 'This session started before two-step sign-in was on. Sign out and sign in again.'
              : report.error.message
          }
        >
          {report.requestId && <span className="font-mono text-xs">Reference: {report.requestId}</span>}
        </Notice>
      ) : (
        <>
          <Card
            title="Platform admins"
            description="Remove access that isn’t needed with pnpm admin:role (recorded, with a reason)."
            className="rise"
          >
            <div className="-mx-5 -mb-5 overflow-x-auto border-t border-line sm:-mx-6 sm:-mb-6">
              <table className="data-table min-w-[40rem]">
                <thead>
                  <tr>
                    <th scope="col">Admin</th>
                    <th scope="col">Two-step</th>
                    <th scope="col">Last active</th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.platformAdmins.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Initials name={a.name} />
                          <div className="min-w-0">
                            <p className="font-medium text-ink">{a.name}</p>
                            {a.email && <p className="truncate text-xs text-ink-3">{a.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td>{a.mfa ? <Pill tone="ok">On</Pill> : <Pill tone="danger">Off</Pill>}</td>
                      <td className="whitespace-nowrap text-ink-2 tabular-nums">{when(a.lastActive)}</td>
                      <td>
                        {a.dormant ? (
                          <Pill tone="wait">Not active for 90 days: remove?</Pill>
                        ) : (
                          <span className="text-ink-2">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Business access" className="rise">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-3">Business owners</dt>
                <dd className="text-lg font-semibold tabular-nums">{report.data.businessAccess.owners}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Employee accounts</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {report.data.businessAccess.employeeAccounts}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Team members by role</dt>
                <dd className="tabular-nums">
                  {Object.entries(report.data.businessAccess.teamMembers)
                    .map(([role, n]) => `${role.replace('_', ' ')} ${n}`)
                    .join(', ') || 'None'}
                </dd>
              </div>
            </dl>
          </Card>
          <p className="text-xs text-ink-3">
            Generated {when(report.data.generatedAt)}. Producing this review is recorded in the audit log.
          </p>
        </>
      )}
    </div>
  );
}

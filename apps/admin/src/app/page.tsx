import type { Metadata } from 'next';
import { SignOut } from '@admin/components/sign-out';
import { Card, Notice } from '@admin/components/ui';
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
 * The first thing an operator sees: who holds platform admin access, whether
 * they use two-step sign-in, and who has gone quiet (SOC 2 access review, D-080).
 * Producing it is itself recorded in the audit log.
 */
export default async function HomePage() {
  const gate = await requireAdmin('/');
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Access review</h1>
          <p className="text-sm text-ink-3">
            Signed in as {gate.me.name}
            {gate.me.email && ` (${gate.me.email})`}
          </p>
        </div>
        <SignOut />
      </div>
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
          <Card title="Platform admins">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-ink-3">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Admin
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Two-step
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Last active
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Review
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.data.platformAdmins.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 pr-4">
                        <span className="font-medium text-ink">{a.name}</span>
                        {a.email && <span className="block text-ink-3">{a.email}</span>}
                      </td>
                      <td className="py-2 pr-4">
                        {a.mfa ? (
                          <span className="text-ok">On</span>
                        ) : (
                          <span className="font-semibold text-danger">Off</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{when(a.lastActive)}</td>
                      <td className="py-2">
                        {a.dormant ? (
                          <span className="font-semibold text-wait">Not active for 90 days: remove?</span>
                        ) : (
                          'Active'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Business access">
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

import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { ArrowRight, ScrollText } from 'lucide-react';
import { Empty } from '@admin/components/empty';
import { Tabs } from '@admin/components/tabs';
import { Timeline } from '@admin/components/timeline';
import { Card, Notice, PageTitle, beat } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { AREAS, PERIODS, type AuditEntry } from '@admin/lib/audit';
import { callApi } from '@admin/lib/gateway';
import { securityEvents } from '@admin/lib/prometheus';

export const metadata: Metadata = { title: 'Audit log' };

const EVENTS: Record<string, string> = {
  refresh_token_reuse: 'A stolen session token used',
  mfa_failed: 'Wrong two-step codes',
  mfa_locked: 'Two-step sign-in locked',
  admin_without_mfa: 'An admin without two-step sign-in',
  member_locked_out: 'Business logins locked out',
  breach_check_unavailable: 'Breached-password check unavailable',
  webhook_signature_invalid: 'Forged webhooks',
  emergency_switch_off: 'Emergency switches turned off',
  emergency_switch_on: 'Emergency switches turned on',
  account_suspended_by_admin: 'Accounts suspended',
  sessions_ended_by_admin: 'People signed out by an admin',
};

const CURSOR = /^\d{1,15}_\d{1,19}$/;

/**
 * The audit log (3.6f, D-132): everything platform admins did — every look at an account, every
 * switch, every business decision, their own sign-ins — newest first, by kind and period, and the
 * security events beside it. Each step says who, what, to what, why, from where, and its reference.
 */
export default async function AuditPage({ searchParams }: PageProps<'/security/audit'>) {
  const gate = await requireAdmin('/security/audit');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const query = await searchParams;
  const area = AREAS.find((a) => a.value === query.area)?.value ?? 'all';
  const days = PERIODS.find((p) => String(p.value) === query.days)?.value ?? 7;
  const before = typeof query.before === 'string' && CURSOR.test(query.before) ? query.before : undefined;
  const params = new URLSearchParams({ days: String(days), limit: '50' });
  if (area !== 'all') params.set('area', area);
  if (before) params.set('before', before);

  const [log, events] = await Promise.all([
    callApi<{ entries: AuditEntry[]; next: string | null }>({
      path: `/v1/admin/audit?${params}`,
      accessToken: gate.accessToken,
      incoming: gate.incoming,
      requestId: gate.requestId,
    }),
    securityEvents(days * 24),
  ]);
  const href = (p: { area?: string; days?: number; before?: string }) => {
    const q = new URLSearchParams();
    const a = p.area ?? area;
    if (a !== 'all') q.set('area', a);
    q.set('days', String(p.days ?? days));
    if (p.before) q.set('before', p.before);
    return `/security/audit?${q}` as Route;
  };
  const top = events?.[0]?.count ?? 0;

  return (
    <>
      <PageTitle
        title="Audit log"
        description="Everything platform admins did: each look at an account, each switch, each business decision, and their own sign-ins. Who, what, why, from where."
      />
      <div className="flex flex-wrap items-start gap-x-4">
        <Tabs
          label="Kind of step"
          items={AREAS.map((a) => ({
            href: href({ area: a.value }),
            label: a.label,
            current: a.value === area,
          }))}
        />
        <Tabs
          label="Period"
          items={PERIODS.map((p) => ({
            href: href({ days: p.value }),
            label: p.label,
            current: p.value === days,
          }))}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {!log.ok ? (
            <Notice tone="danger" title={log.error.message}>
              {log.requestId && <span className="font-mono text-xs">Reference: {log.requestId}</span>}
            </Notice>
          ) : log.data.entries.length === 0 ? (
            <Empty icon={ScrollText} title="Nothing recorded" text="No step of this kind in this period." />
          ) : (
            <section aria-label="Steps" className="panel rise p-4 sm:p-6" style={beat(1)}>
              <Timeline entries={log.data.entries} self={gate.me.id} />
            </section>
          )}
          {log.ok && (before || log.data.next) && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
              {before ? (
                <Link className="font-medium text-ink-2 hover:text-ink" href={href({})}>
                  Newest
                </Link>
              ) : (
                <span />
              )}
              {log.data.next && (
                <Link
                  className="press inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3.5 font-medium text-ink ring-1 ring-line-strong ring-inset hover:bg-raised"
                  href={href({ before: log.data.next })}
                >
                  Older <ArrowRight aria-hidden className="size-4" />
                </Link>
              )}
            </nav>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <Card
            title="Security events"
            description={`Last ${PERIODS.find((p) => p.value === days)?.label}, counted by every service.`}
            className="rise"
          >
            {events === null ? (
              <p className="text-sm text-ink-3">Monitoring isn’t connected here.</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-ink-2">None in this period.</p>
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Security events by kind">
                {events.map((e) => (
                  <li key={e.event} className="flex flex-col gap-1.5">
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink-2">{EVENTS[e.event] ?? e.event.replaceAll('_', ' ')}</span>
                      <span className="font-semibold text-ink tabular-nums">{e.count}</span>
                    </span>
                    <span aria-hidden className="h-1.5 rounded-full bg-sunken">
                      <span
                        className="block h-full rounded-full bg-ink-3"
                        style={{ width: `${Math.max(4, (e.count / (top || 1)) * 100)}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="How this log works" className="rise">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
              <li>Kept on each person’s own record; nobody can change or delete an entry.</li>
              <li>A business’s own record keeps its side of each decision too.</li>
              <li>
                One person’s full trail:{' '}
                <Link
                  className="font-medium text-brand-text underline-offset-4 hover:underline"
                  href="/accounts"
                >
                  Accounts
                </Link>
                , then “Recent activity”. Opening it is recorded.
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}

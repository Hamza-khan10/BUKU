import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Card, Notice, PageTitle, Pill, Stat } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';
import { grafana, systemStatus } from '@admin/lib/prometheus';

export const metadata: Metadata = { title: 'Overview' };

interface AccessReport {
  platformAdmins: { mfa: boolean; dormant: boolean }[];
}

const fixed = (n: number | null, digits: number) => (n === null ? '—' : n.toFixed(digits));

/**
 * The operator's first look (3.6b): is the system well, is anything under attack, and what is
 * waiting for a decision. Each part loads on its own; one that can't says so instead of hiding
 * the rest.
 */
export default async function OverviewPage() {
  const gate = await requireAdmin('/');
  if (gate.kind === 'unavailable') {
    return (
      <Notice tone="danger" title={gate.message}>
        {gate.reference && <span className="font-mono text-xs">Reference: {gate.reference}</span>}
      </Notice>
    );
  }
  const call = <T,>(path: string) =>
    callApi<T>({ path, accessToken: gate.accessToken, incoming: gate.incoming, requestId: gate.requestId });
  const [status, pending, reports, access] = await Promise.all([
    systemStatus(),
    call<unknown[]>('/v1/admin/businesses?status=pending&limit=1'),
    call<unknown[]>('/v1/admin/business-reports?status=open&limit=1'),
    call<AccessReport>('/v1/admin/access-review'),
  ]);
  const links = grafana();
  const down = status?.services.filter((s) => !s.up) ?? [];
  const critical = status?.alerts.filter((a) => a.severity === 'critical') ?? [];
  const dbTrouble = status?.database.filter((c) => c.status > 0) ?? [];
  const withoutTwoStep = access.ok ? access.data.platformAdmins.filter((a) => !a.mfa).length : null;

  return (
    <>
      <PageTitle
        title="Overview"
        description="Is BUKU well, is anything under attack, and what is waiting for you."
        actions={
          links && (
            <a
              href={links.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-semibold hover:bg-raised"
            >
              Open Grafana <ExternalLink aria-hidden className="size-4" />
            </a>
          )
        }
      />

      <section aria-labelledby="system" className="mb-8 flex flex-col gap-3">
        <h2 id="system" className="text-sm font-semibold tracking-wide text-ink-3 uppercase">
          The system, last 5 minutes
        </h2>
        {!status ? (
          <Notice title="Monitoring isn’t connected here">
            Start it with <code className="font-mono">pnpm dev:monitoring</code> (PROMETHEUS_URL in this app’s
            settings). Production connects to its own.
          </Notice>
        ) : (
          <>
            {(down.length > 0 || critical.length > 0) && (
              <Notice tone="danger" title="Something needs someone now">
                {down.length > 0 && <p>Not answering: {down.map((s) => s.job).join(', ')}.</p>}
                {critical.length > 0 && <p>Critical alerts: {critical.map((a) => a.name).join(', ')}.</p>}
              </Notice>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Answering"
                value={`${status.services.filter((s) => s.up).length} of ${status.services.length}`}
                tone={down.length ? 'danger' : 'ok'}
                hint="Services, the gateway and the database checks"
              />
              <Stat label="Requests per second" value={fixed(status.requestsPerSecond, 2)} tone="info" />
              <Stat
                label="Server errors"
                value={`${fixed(status.errorPercent, 2)}%`}
                tone={
                  (status.errorPercent ?? 0) >= 10
                    ? 'danger'
                    : (status.errorPercent ?? 0) >= 2
                      ? 'wait'
                      : 'ok'
                }
                hint="Alerts at 2% and 10%"
              />
              <Stat
                label="95th percentile"
                value={status.p95Seconds === null ? '—' : `${Math.round(status.p95Seconds * 1000)} ms`}
                tone={
                  (status.p95Seconds ?? 0) >= 1 ? 'danger' : (status.p95Seconds ?? 0) >= 0.5 ? 'wait' : 'ok'
                }
              />
              <Stat
                label="Security events, last hour"
                value={fixed(status.securityEventsHour, 0)}
                tone={
                  (status.securityEventsHour ?? 0) >= 20
                    ? 'danger'
                    : (status.securityEventsHour ?? 0) > 0
                      ? 'wait'
                      : 'ok'
                }
                hint="Token reuse, code guessing, lockouts, forged webhooks"
              />
              <Stat
                label="Refused per second"
                value={fixed(status.refusedPerSecond, 2)}
                tone={
                  (status.refusedPerSecond ?? 0) >= 5
                    ? 'danger'
                    : (status.refusedPerSecond ?? 0) >= 1
                      ? 'wait'
                      : 'ok'
                }
                hint="401, 403 and 429 answers"
              />
              <Stat
                label="Alerts firing"
                value={status.alerts.length}
                tone={critical.length ? 'danger' : status.alerts.length ? 'wait' : 'ok'}
              />
              <Stat
                label="Database checks"
                value={dbTrouble.length ? `${dbTrouble.length} not OK` : 'All OK'}
                tone={dbTrouble.some((c) => c.status === 2) ? 'danger' : dbTrouble.length ? 'wait' : 'ok'}
                hint={`${status.database.length} checks, every minute`}
              />
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="waiting" className="mb-8 flex flex-col gap-3">
        <h2 id="waiting" className="text-sm font-semibold tracking-wide text-ink-3 uppercase">
          Waiting for a decision
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Waiting
            href="/businesses"
            label="Businesses to verify"
            count={pending.ok ? (pending.meta?.total ?? null) : null}
          />
          <Waiting
            href="/reports"
            label="Open reports"
            count={reports.ok ? (reports.meta?.total ?? null) : null}
          />
          <Waiting
            href="/security/access"
            label="Admins without two-step sign-in"
            count={withoutTwoStep}
            bad
          />
        </div>
      </section>

      {links && (
        <Card title="Dashboards">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {links.dashboards.map((d) => (
              <li key={d.title}>
                <a
                  href={d.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-raised"
                >
                  BUKU · {d.title}
                  <ExternalLink aria-hidden className="size-4 text-ink-3" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Waiting({
  href,
  label,
  count,
  bad = false,
}: {
  href: Route;
  label: string;
  count: number | null;
  bad?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between rounded-lg border border-line bg-surface p-4 hover:bg-raised"
    >
      <span className="flex flex-col gap-1">
        <span className="text-sm text-ink-2">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">
          {count === null ? <Pill tone="danger">Couldn’t load</Pill> : count}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {count !== null && count > 0 && <Pill tone={bad ? 'danger' : 'wait'}>{bad ? 'Fix' : 'Waiting'}</Pill>}
        <ArrowRight
          aria-hidden
          className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}

import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { Card, Notice, PageTitle, Pill, StatusDot, cx } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { grafana, systemStatus } from '@admin/lib/prometheus';

export const metadata: Metadata = { title: 'Monitoring' };

const STATUS = [
  { text: 'OK', tone: 'ok' },
  { text: 'Warning', tone: 'wait' },
  { text: 'Critical', tone: 'danger' },
] as const;

/** "buku-auth-service" → "auth-service"; the rest as they are. */
const jobName = (job: string) => job.replace(/^buku-/, '');

/**
 * Everything Prometheus watches, now (D-127): each target answering or not, the alerts firing, the
 * database's checks; the Grafana dashboards for the history.
 */
export default async function MonitoringPage() {
  const gate = await requireAdmin('/monitoring');
  if (gate.kind === 'unavailable') return <Notice tone="danger" title={gate.message} />;
  const [status, links] = [await systemStatus(), grafana()];

  const answering = status?.services.filter((s) => s.up).length ?? 0;
  return (
    <>
      <PageTitle
        title="Monitoring"
        description="What Prometheus reads every 15 seconds: who answers, what's firing, and the database's own checks. History and detail are in Grafana."
      />
      {!status ? (
        <Notice title="Monitoring isn’t connected here">
          Start it with <code className="font-mono">pnpm dev:monitoring</code> and set PROMETHEUS_URL in this
          app’s settings. Production connects to its own.
        </Notice>
      ) : (
        <div className="flex flex-col gap-6">
          <Card
            title="Targets"
            description={`${answering} of ${status.services.length} answering`}
            className="rise"
          >
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {status.services.map((s) => (
                <li
                  key={s.job}
                  className={cx(
                    'flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset',
                    s.up ? 'bg-sunken/60 ring-line' : 'bg-danger-soft ring-danger/40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <StatusDot tone={s.up ? 'ok' : 'danger'} live={!s.up} />
                    <span className="truncate font-mono text-[0.82rem]">{jobName(s.job)}</span>
                  </span>
                  <span className={cx('text-xs font-semibold', s.up ? 'text-ok' : 'text-danger')}>
                    {s.up ? 'Answering' : 'Not answering'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Alerts firing"
              description="What to do for each: docs/compliance/runbooks.md."
              className="rise"
            >
              {status.alerts.length === 0 ? (
                <p className="flex items-center gap-2.5 text-sm text-ink-2">
                  <StatusDot tone="ok" /> Nothing is firing.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {status.alerts.map((a, i) => (
                    <li
                      key={`${a.name}-${i}`}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{a.name}</span>
                        {a.summary && <span className="text-ink-3"> · {a.summary}</span>}
                      </span>
                      <Pill tone={a.severity === 'critical' ? 'danger' : 'wait'}>{a.severity}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Dashboards" description="History and detail, in Grafana." className="rise">
              {!links ? (
                <p className="text-sm text-ink-3">
                  Set GRAFANA_URL in this app’s settings to link them here.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {links.dashboards.map((d) => (
                    <li key={d.title}>
                      <a
                        href={d.href}
                        target="_blank"
                        rel="noreferrer"
                        className="press group flex items-center justify-between rounded-xl bg-sunken/60 px-3.5 py-3 text-sm font-medium ring-1 ring-line ring-inset hover:ring-line-strong"
                      >
                        {d.title}
                        <span className="sr-only"> dashboard (opens Grafana)</span>
                        <ExternalLink
                          aria-hidden
                          className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card
            title="Database checks"
            description="Run every minute by the db-health sidecar: the same checks as pnpm db:health."
            className="rise"
          >
            {status.database.length === 0 ? (
              <p className="text-sm text-wait">
                No results yet: the db-health sidecar runs them every minute.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {status.database.map((c) => (
                  <li
                    key={c.check}
                    className="flex items-center justify-between gap-3 rounded-xl bg-sunken/60 px-3.5 py-2.5 ring-1 ring-line ring-inset"
                  >
                    <span className="truncate font-mono text-[0.82rem]">{c.check}</span>
                    <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].text}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

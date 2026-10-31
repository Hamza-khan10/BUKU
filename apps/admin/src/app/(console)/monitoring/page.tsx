import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { Card, Notice, PageTitle, Pill } from '@admin/components/ui';
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Targets">
            <ul className="divide-y divide-line">
              {status.services.map((s) => (
                <li key={s.job} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono">{jobName(s.job)}</span>
                  <Pill tone={s.up ? 'ok' : 'danger'}>{s.up ? 'Answering' : 'Not answering'}</Pill>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Alerts firing">
            {status.alerts.length === 0 ? (
              <p className="text-sm text-ok">None.</p>
            ) : (
              <ul className="divide-y divide-line">
                {status.alerts.map((a, i) => (
                  <li key={`${a.name}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{a.name}</span>
                      {a.summary && <span className="text-ink-3"> · {a.summary}</span>}
                    </span>
                    <Pill tone={a.severity === 'critical' ? 'danger' : 'wait'}>{a.severity}</Pill>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-3">What to do for each: docs/compliance/runbooks.md.</p>
          </Card>
          <Card title="Database checks">
            {status.database.length === 0 ? (
              <p className="text-sm text-wait">
                No results yet: the db-health sidecar runs them every minute.
              </p>
            ) : (
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {status.database.map((c) => (
                  <li
                    key={c.check}
                    className="flex items-center justify-between border-b border-line py-2 text-sm"
                  >
                    <span className="font-mono">{c.check}</span>
                    <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].text}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Dashboards">
            {!links ? (
              <p className="text-sm text-ink-3">Set GRAFANA_URL in this app’s settings to link them here.</p>
            ) : (
              <ul className="flex flex-col gap-2">
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
            )}
          </Card>
        </div>
      )}
    </>
  );
}

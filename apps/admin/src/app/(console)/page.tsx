import type { Metadata, Route } from 'next';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BellRing,
  Database,
  ExternalLink,
  Flag,
  LayoutDashboard,
  Network,
  ShieldAlert,
  ServerCrash,
  ShieldCheck,
  Siren,
  Store,
  Timer,
  Unplug,
  UserRoundX,
  type LucideIcon,
} from 'lucide-react';
import { Sparkline } from '@admin/components/sparkline';
import { Notice, PageTitle, Pill, SectionTitle, Stat, beat, cx } from '@admin/components/ui';
import { requireAdmin } from '@admin/lib/admin';
import { callApi } from '@admin/lib/gateway';
import { grafana, systemStatus, systemTrends } from '@admin/lib/prometheus';
import { switchName, type SwitchView } from '@admin/lib/switches';

export const metadata: Metadata = { title: 'Overview' };

interface AccessReport {
  platformAdmins: { mfa: boolean; dormant: boolean }[];
}

const fixed = (n: number | null, digits: number) => (n === null ? '—' : n.toFixed(digits));
const millis = (v: number) => `${Math.round(v * 1000)} ms`;

const DASHBOARD_ICONS: Record<string, LucideIcon> = {
  Platform: LayoutDashboard,
  Security: ShieldAlert,
  Gateway: Network,
  Database,
};

/**
 * The operator's first look (3.6b, redrawn in D-131): is BUKU well, is anything under attack, and
 * what is waiting for a decision. Each part loads on its own; one that can't says so instead of
 * hiding the rest.
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
  const [status, trends, pending, reports, access, switches] = await Promise.all([
    systemStatus(),
    systemTrends(),
    call<unknown[]>('/v1/admin/businesses?status=pending&limit=1'),
    call<unknown[]>('/v1/admin/business-reports?status=open&limit=1'),
    call<AccessReport>('/v1/admin/access-review'),
    call<SwitchView[]>('/v1/admin/switches'),
  ]);
  const switchedOff = switches.ok ? switches.data.filter((s) => s.off) : [];
  const links = grafana();
  const down = status?.services.filter((s) => !s.up) ?? [];
  const critical = status?.alerts.filter((a) => a.severity === 'critical') ?? [];
  const dbTrouble = status?.database.filter((c) => c.status > 0) ?? [];
  const withoutTwoStep = access.ok ? access.data.platformAdmins.filter((a) => !a.mfa).length : null;
  const errorTone =
    (status?.errorPercent ?? 0) >= 10 ? 'danger' : (status?.errorPercent ?? 0) >= 2 ? 'wait' : 'ok';
  const p95Tone =
    (status?.p95Seconds ?? 0) >= 1 ? 'danger' : (status?.p95Seconds ?? 0) >= 0.5 ? 'wait' : 'ok';
  const refusedTone =
    (status?.refusedPerSecond ?? 0) >= 5 ? 'danger' : (status?.refusedPerSecond ?? 0) >= 1 ? 'wait' : 'ok';
  const now = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date());

  return (
    <>
      <PageTitle
        eyebrow={`${now} UTC`}
        title="Overview"
        description="Is BUKU well, is anything under attack, and what is waiting for you."
      />

      {switchedOff.length > 0 && (
        <div className="rise mb-6">
          <Notice
            tone="danger"
            title={`Turned off: ${switchedOff.map((s) => switchName(s.key)).join(', ')}`}
            action={
              <Link
                href="/security/switches"
                className="press inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-danger hover:bg-danger/10"
              >
                Emergency switches <ArrowRight aria-hidden className="size-4" />
              </Link>
            }
          >
            People trying these are told it’s paused. The switches page says who turned them off and why.
          </Notice>
        </div>
      )}
      {!switches.ok && (
        <div className="rise mb-6">
          <Notice tone="wait" title="The emergency switches couldn’t be read">
            <Link href="/security/switches" className="font-medium underline underline-offset-4">
              Emergency switches
            </Link>{' '}
            shows them, or why not.
          </Notice>
        </div>
      )}

      <StatusBand
        state={!status ? 'unknown' : down.length > 0 || critical.length > 0 ? 'trouble' : 'well'}
        facts={
          status
            ? [
                `${status.services.filter((s) => s.up).length} of ${status.services.length} answering`,
                status.alerts.length === 0 ? 'no alerts firing' : `${status.alerts.length} alerts firing`,
                dbTrouble.length === 0
                  ? `${status.database.length} database checks OK`
                  : `${dbTrouble.length} database checks not OK`,
              ]
            : []
        }
        trouble={[
          ...(down.length > 0
            ? [`Not answering: ${down.map((s) => s.job.replace(/^buku-/, '')).join(', ')}.`]
            : []),
          ...(critical.length > 0 ? [`Critical alerts: ${critical.map((a) => a.name).join(', ')}.`] : []),
        ]}
        grafanaUrl={links?.url ?? null}
      />

      {status && (
        <section aria-labelledby="traffic" className="mb-10 flex flex-col gap-4">
          <SectionTitle
            id="traffic"
            title="Traffic, last hour"
            description="Read from Prometheus every time this page loads."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              style={beat(1)}
              icon={Activity}
              label="Requests per second"
              value={fixed(status.requestsPerSecond, 2)}
              hint="Every service, through the gateway"
              trend={
                <Sparkline points={trends?.requests ?? null} label="Requests per second" unit="per-second" />
              }
            />
            <Stat
              style={beat(2)}
              icon={ServerCrash}
              label="Server errors"
              value={`${fixed(status.errorPercent, 2)}%`}
              tone={errorTone}
              hint="Alerts at 2% and 10%"
              trend={
                <Sparkline
                  points={trends?.errors ?? null}
                  label="Server errors"
                  unit="percent"
                  tone={errorTone === 'ok' ? 'brand' : errorTone}
                />
              }
            />
            <Stat
              style={beat(3)}
              icon={Timer}
              label="95th percentile"
              value={status.p95Seconds === null ? '—' : millis(status.p95Seconds)}
              tone={p95Tone}
              hint="How long the slowest 5% take"
              trend={
                <Sparkline
                  points={trends?.p95 ?? null}
                  label="95th percentile"
                  unit="millis"
                  tone={p95Tone === 'ok' ? 'brand' : p95Tone}
                />
              }
            />
            <Stat
              style={beat(4)}
              icon={ShieldAlert}
              label="Refused per second"
              value={fixed(status.refusedPerSecond, 2)}
              tone={refusedTone}
              hint="401, 403 and 429 at the gateway"
              trend={
                <Sparkline
                  points={trends?.refused ?? null}
                  label="Refused per second"
                  unit="per-second"
                  tone={refusedTone === 'ok' ? 'brand' : refusedTone}
                />
              }
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              style={beat(5)}
              icon={BellRing}
              label="Security events, last hour"
              value={fixed(status.securityEventsHour, 0)}
              tone={
                (status.securityEventsHour ?? 0) >= 20
                  ? 'danger'
                  : (status.securityEventsHour ?? 0) > 0
                    ? 'wait'
                    : 'ok'
              }
              hint="Token reuse, code guessing, lockouts, forged webhooks, switches"
            />
            <Stat
              style={beat(6)}
              icon={Siren}
              label="Alerts firing"
              value={status.alerts.length}
              tone={critical.length ? 'danger' : status.alerts.length ? 'wait' : 'ok'}
              hint={status.alerts.length ? status.alerts.map((a) => a.name).join(', ') : 'Nothing firing'}
            />
            <Stat
              style={beat(7)}
              icon={Database}
              label="Database checks"
              value={dbTrouble.length ? `${dbTrouble.length} not OK` : 'All OK'}
              tone={dbTrouble.some((c) => c.status === 2) ? 'danger' : dbTrouble.length ? 'wait' : 'ok'}
              hint={`${status.database.length} checks, every minute`}
            />
          </div>
        </section>
      )}

      <section aria-labelledby="waiting" className="mb-10 flex flex-col gap-4">
        <SectionTitle id="waiting" title="Waiting for a decision" />
        <div className="grid gap-4 md:grid-cols-3">
          <Waiting
            i={8}
            href="/businesses"
            icon={Store}
            label="Businesses to verify"
            count={pending.ok ? (pending.meta?.total ?? null) : null}
          />
          <Waiting
            i={9}
            href="/reports"
            icon={Flag}
            label="Open reports"
            count={reports.ok ? (reports.meta?.total ?? null) : null}
          />
          <Waiting
            i={10}
            href="/security/access"
            icon={UserRoundX}
            label="Admins without two-step sign-in"
            count={withoutTwoStep}
            bad
          />
        </div>
      </section>

      {links && (
        <section aria-labelledby="dashboards" className="flex flex-col gap-4">
          <SectionTitle id="dashboards" title="Dashboards" description="History and detail, in Grafana." />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {links.dashboards.map((d, i) => {
              const Icon = DASHBOARD_ICONS[d.title] ?? LayoutDashboard;
              return (
                <li key={d.title} className="rise" style={beat(11 + i)}>
                  <a
                    href={d.href}
                    target="_blank"
                    rel="noreferrer"
                    className="panel press group flex items-center gap-3 p-3.5 hover:border-line-strong"
                  >
                    <span className="grid size-9 place-items-center rounded-[10px] bg-sunken text-ink-2 ring-1 ring-line ring-inset group-hover:text-brand-text">
                      <Icon aria-hidden strokeWidth={1.8} className="size-[1.1rem]" />
                    </span>
                    <span className="flex-1 text-sm font-medium">
                      {d.title}
                      <span className="sr-only"> dashboard (opens Grafana)</span>
                    </span>
                    <ExternalLink
                      aria-hidden
                      className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

/** The one-line answer to "is BUKU well?", in the colour of the answer. */
function StatusBand({
  state,
  facts,
  trouble,
  grafanaUrl,
}: {
  state: 'well' | 'trouble' | 'unknown';
  facts: string[];
  trouble: string[];
  grafanaUrl: string | null;
}) {
  const look = {
    well: {
      icon: ShieldCheck,
      title: 'All systems answering',
      glow: 'var(--glow-brand)',
      mark: 'bg-brand-soft text-brand-text',
    },
    trouble: {
      icon: Siren,
      title: 'Something needs someone now',
      glow: 'var(--glow-danger)',
      mark: 'bg-danger-soft text-danger',
    },
    unknown: {
      icon: Unplug,
      title: 'Monitoring isn’t connected here',
      glow: 'var(--glow-spark)',
      mark: 'bg-wait-soft text-wait',
    },
  }[state];
  const Icon = look.icon;
  return (
    <section
      aria-label="System status"
      className={cx(
        'panel rise relative mb-10 overflow-hidden p-5 sm:p-7',
        state === 'trouble' && 'border-danger/45',
      )}
      style={{
        ...beat(0),
        backgroundImage: `radial-gradient(40rem 16rem at 0% 0%, ${look.glow}, transparent 70%)`,
      }}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className={cx('grid size-12 shrink-0 place-items-center rounded-2xl', look.mark)}>
            <Icon aria-hidden strokeWidth={1.8} className="size-6" />
          </span>
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2.5 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
              {look.title}
              {state === 'well' && <Pill tone="ok">Live</Pill>}
            </p>
            {state === 'unknown' ? (
              <p className="text-sm text-ink-2">
                Start it with <code className="font-mono text-[0.85em]">pnpm dev:monitoring</code>{' '}
                (PROMETHEUS_URL in this app’s settings). Production connects to its own.
              </p>
            ) : (
              <p className="text-sm text-ink-2">{facts.join(' · ')}</p>
            )}
            {trouble.map((t) => (
              <p key={t} className="text-sm font-medium text-danger">
                {t}
              </p>
            ))}
          </div>
        </div>
        {grafanaUrl && (
          <a
            href={grafanaUrl}
            target="_blank"
            rel="noreferrer"
            className="press inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-[10px] border border-line-strong bg-raised px-4 text-sm font-semibold hover:border-control sm:self-center"
          >
            Open Grafana <ExternalLink aria-hidden className="size-4" />
          </a>
        )}
      </div>
    </section>
  );
}

function Waiting({
  i,
  href,
  icon: Icon,
  label,
  count,
  bad = false,
}: {
  i: number;
  href: Route;
  icon: LucideIcon;
  label: string;
  count: number | null;
  bad?: boolean;
}) {
  const waiting = count !== null && count > 0;
  return (
    <Link
      href={href}
      style={beat(i)}
      className="panel press rise group flex items-center gap-4 p-4 hover:border-line-strong sm:p-5"
    >
      <span
        className={cx(
          'grid size-11 shrink-0 place-items-center rounded-xl',
          !waiting
            ? 'bg-sunken text-ink-3 ring-1 ring-line ring-inset'
            : bad
              ? 'bg-danger-soft text-danger'
              : 'bg-wait-soft text-wait',
        )}
      >
        <Icon aria-hidden strokeWidth={1.8} className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm text-ink-2">{label}</span>
        <span className="text-2xl leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {count === null ? <Pill tone="danger">Couldn’t load</Pill> : count}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {waiting && <Pill tone={bad ? 'danger' : 'wait'}>{bad ? 'Fix' : 'Waiting'}</Pill>}
        <ArrowRight
          aria-hidden
          className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}

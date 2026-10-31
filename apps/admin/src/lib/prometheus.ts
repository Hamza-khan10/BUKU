import 'server-only';
import { env } from './env';

/**
 * The console's view of the system (D-127), read from Prometheus by this server: the same numbers
 * Grafana shows, a few at a time. Never thrown: no Prometheus, or a query that fails, comes back
 * as `null` and the page says so.
 */

interface Sample {
  metric: Record<string, string>;
  value: [number, string];
}

async function query(expr: string): Promise<Sample[] | null> {
  const base = env().PROMETHEUS_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/v1/query?query=${encodeURIComponent(expr)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; data?: { result?: Sample[] } };
    return body.status === 'success' ? (body.data?.result ?? []) : null;
  } catch {
    return null;
  }
}

const one = (samples: Sample[] | null): number | null => {
  const value = samples?.[0]?.value[1];
  if (value === undefined) return samples ? 0 : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export interface ServiceStatus {
  job: string;
  up: boolean;
}
export interface Alert {
  name: string;
  severity: string;
  summary: string;
}
export interface DatabaseCheck {
  check: string;
  status: 0 | 1 | 2;
}

export interface SystemStatus {
  services: ServiceStatus[];
  requestsPerSecond: number | null;
  errorPercent: number | null;
  p95Seconds: number | null;
  securityEventsHour: number | null;
  refusedPerSecond: number | null;
  alerts: Alert[];
  database: DatabaseCheck[];
}

const REQ = 'http_request_duration_seconds_count';

/** Everything the overview and the monitoring page show, read side by side. Null: not connected. */
export async function systemStatus(): Promise<SystemStatus | null> {
  if (!env().PROMETHEUS_URL) return null;
  const [up, rps, errors, p95, security, refused, alerts, database] = await Promise.all([
    query('up'),
    query(`sum(rate(${REQ}[5m]))`),
    query(
      `100 * (sum(rate(${REQ}{status_code=~"5.."}[5m])) or vector(0)) / clamp_min(sum(rate(${REQ}[5m])), 1e-9)`,
    ),
    query('histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))'),
    query('sum(increase(security_events_total[1h]))'),
    // Refusals counted at the gateway, which turns most away before any service sees them.
    query('sum(rate(kong_http_requests_total{code=~"401|403|429"}[5m])) or vector(0)'),
    // Alerts that are firing now (pending ones are still being sure).
    query('ALERTS{alertstate="firing"}'),
    query('max by (check) (buku_db_check_status)'),
  ]);
  if (up === null) return null;
  return {
    services: up
      .map((s) => ({ job: s.metric.job ?? '?', up: s.value[1] === '1' }))
      .sort((a, b) => a.job.localeCompare(b.job)),
    requestsPerSecond: one(rps),
    errorPercent: one(errors),
    p95Seconds: one(p95),
    securityEventsHour: one(security),
    refusedPerSecond: one(refused),
    alerts: (alerts ?? []).map((s) => ({
      name: s.metric.alertname ?? 'Alert',
      severity: s.metric.severity ?? 'warning',
      summary: s.metric.check ?? s.metric.service ?? s.metric.job ?? '',
    })),
    database: (database ?? [])
      .map((s) => ({
        check: s.metric.check ?? '?',
        status: Math.min(2, Math.max(0, Number(s.value[1]))) as 0 | 1 | 2,
      }))
      .sort((a, b) => b.status - a.status || a.check.localeCompare(b.check)),
  };
}

interface RangeSample {
  metric: Record<string, string>;
  values: [number, string][];
}

/** One measure over the last `minutes`, a point a minute; null when it can't be read. */
async function series(expr: string, minutes = 60): Promise<[number, number][] | null> {
  const base = env().PROMETHEUS_URL;
  if (!base) return null;
  const end = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query: expr,
    start: String(end - minutes * 60),
    end: String(end),
    step: '60',
  });
  try {
    const res = await fetch(`${base}/api/v1/query_range?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; data?: { result?: RangeSample[] } };
    if (body.status !== 'success') return null;
    const values = body.data?.result?.[0]?.values ?? [];
    return values.map(([t, v]) => [t, Number(v)] as [number, number]).filter(([, v]) => Number.isFinite(v));
  } catch {
    return null;
  }
}

export interface SystemTrends {
  requests: [number, number][] | null;
  errors: [number, number][] | null;
  p95: [number, number][] | null;
  refused: [number, number][] | null;
}

/** The overview's numbers over the last hour, for their trend lines. */
export async function systemTrends(): Promise<SystemTrends | null> {
  if (!env().PROMETHEUS_URL) return null;
  const [requests, errors, p95, refused] = await Promise.all([
    series(`sum(rate(${REQ}[5m]))`),
    series(
      `100 * (sum(rate(${REQ}{status_code=~"5.."}[5m])) or vector(0)) / clamp_min(sum(rate(${REQ}[5m])), 1e-9)`,
    ),
    series('histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))'),
    series('sum(rate(kong_http_requests_total{code=~"401|403|429"}[5m])) or vector(0)'),
  ]);
  return { requests, errors, p95, refused };
}

/** Security events by kind over the last `hours`, largest first; null when not connected. */
export async function securityEvents(hours: number): Promise<{ event: string; count: number }[] | null> {
  if (!env().PROMETHEUS_URL) return null;
  const rows = await query(`sum by (event) (increase(security_events_total[${Math.round(hours)}h]))`);
  if (rows === null) return null;
  return rows
    .map((r) => ({ event: r.metric.event ?? '?', count: Math.round(Number(r.value[1])) }))
    .filter((r) => Number.isFinite(r.count) && r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Grafana's address and its BUKU dashboards (by their fixed ids), or null when not set. */
export function grafana(): { url: string; dashboards: { title: string; href: string }[] } | null {
  const url = env().GRAFANA_URL;
  if (!url) return null;
  return {
    url,
    dashboards: [
      { title: 'Platform', href: `${url}/d/buku-platform` },
      { title: 'Security', href: `${url}/d/buku-security` },
      { title: 'Gateway', href: `${url}/d/buku-gateway` },
      { title: 'Database', href: `${url}/d/buku-database` },
    ],
  };
}

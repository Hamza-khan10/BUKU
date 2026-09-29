/**
 * Liveness vs readiness (they are different questions):
 *
 *  GET /health — "is the process alive?" Always 200 unless the event loop is
 *                wedged. Orchestrators RESTART the container when it fails, so
 *                it must NOT depend on the database: a DB outage should not
 *                cause every service to restart in a loop.
 *
 *  GET /ready  — "should traffic be sent here?" Runs dependency checks
 *                (Postgres, Valkey, ...). Orchestrators stop ROUTING to the
 *                instance when it fails. Also fails while shutting down so the
 *                load balancer drains us before we close.
 */

export type CheckFn = () => Promise<unknown>;

export interface CheckResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready' | 'shutting_down';
  checks: Record<string, CheckResult>;
}

export class Readiness {
  private readonly checks = new Map<string, CheckFn>();
  private shuttingDown = false;

  constructor(private readonly timeoutMs = 2_000) {}

  add(name: string, check: CheckFn): this {
    this.checks.set(name, check);
    return this;
  }

  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async evaluate(): Promise<ReadinessReport> {
    const entries = await Promise.all(
      [...this.checks].map(async ([name, check]) => [name, await this.run(check)] as const),
    );
    const checks = Object.fromEntries(entries);
    if (this.shuttingDown) return { status: 'shutting_down', checks };
    const allUp = entries.every(([, r]) => r.status === 'up');
    return { status: allUp ? 'ready' : 'not_ready', checks };
  }

  private async run(check: CheckFn): Promise<CheckResult> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
        }),
      ]);
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      // Error text is exposed on /ready (internal endpoint, not routed by the
      // gateway) and kept short to avoid leaking connection strings.
      const message = err instanceof Error ? err.message.split('\n')[0]!.slice(0, 200) : 'check failed';
      return { status: 'down', latencyMs: Math.round(performance.now() - started), error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Readiness check for dependencies we only need to reach over TCP (e.g. SMTP). */
export async function tcpPing(host: string, port: number, timeoutMs = 1_500): Promise<void> {
  const { connect } = await import('node:net');
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port, timeout: timeoutMs });
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`timeout connecting to ${host}:${port}`));
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

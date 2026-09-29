import type { Server } from 'node:http';
import type { Express } from 'express';
import type { Logger } from '../logger.js';
import type { Readiness } from './readiness.js';

/**
 * Starts the HTTP server and owns the process lifecycle.
 *
 * Graceful shutdown on SIGTERM/SIGINT (what Docker and Kubernetes send):
 *   1. /ready starts returning 503 → the load balancer stops sending traffic
 *   2. wait SHUTDOWN_DELAY_MS for that to propagate
 *   3. stop accepting connections; let in-flight requests finish
 *   4. run cleanup hooks in reverse registration order
 *      (e.g. stop Kafka consumers → flush producer → close DB pool)
 *   5. exit 0 — or exit 1 if it takes longer than the hard deadline
 *
 * Crashes: an uncaught exception leaves the process in an unknown state, so
 * it is logged and the process exits; the orchestrator starts a fresh one.
 */

export type ShutdownHook = { name: string; fn: () => Promise<void> };

export interface RunServiceOptions {
  app: Express;
  port: number;
  logger: Logger;
  readiness: Readiness;
  shutdownDelayMs?: number;
  /** Hard deadline for the whole shutdown sequence. */
  shutdownTimeoutMs?: number;
  hooks?: ShutdownHook[];
}

export interface RunningService {
  server: Server;
  shutdown: (reason: string) => Promise<void>;
}

export function runService(options: RunServiceOptions): Promise<RunningService> {
  const { app, port, logger, readiness } = options;
  const hooks = [...(options.hooks ?? [])];
  const delay = options.shutdownDelayMs ?? 0;
  const deadline = options.shutdownTimeoutMs ?? 25_000;

  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    // Keep-alive must outlive the upstream proxy's idle timeout (Kong/nginx
    // default 60s), otherwise the proxy reuses sockets we already closed → 502s.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
    // Slowloris protection: a request must complete within 30s.
    server.requestTimeout = 30_000;

    let shuttingDown: Promise<void> | undefined;
    const shutdown = (reason: string): Promise<void> => {
      shuttingDown ??= (async () => {
        logger.info({ reason }, 'shutdown started');
        const killer = setTimeout(() => {
          logger.fatal('shutdown deadline exceeded, forcing exit');
          process.exit(1);
        }, deadline);
        killer.unref();

        readiness.markShuttingDown();
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));

        await new Promise<void>((done) => {
          server.close(() => done());
          server.closeIdleConnections();
        });

        for (const hook of hooks.reverse()) {
          try {
            await hook.fn();
            logger.info({ hook: hook.name }, 'shutdown hook completed');
          } catch (err) {
            logger.error({ err, hook: hook.name }, 'shutdown hook failed');
          }
        }
        logger.info('shutdown complete');
      })();
      return shuttingDown;
    };

    const exitAfter = (reason: string, code: number) => {
      void shutdown(reason).finally(() => process.exit(code));
    };

    process.once('SIGTERM', () => exitAfter('SIGTERM', 0));
    process.once('SIGINT', () => exitAfter('SIGINT', 0));
    process.on('unhandledRejection', (err) => {
      logger.fatal({ err }, 'unhandled promise rejection');
      exitAfter('unhandledRejection', 1);
    });
    process.on('uncaughtException', (err) => {
      logger.fatal({ err }, 'uncaught exception');
      exitAfter('uncaughtException', 1);
    });

    server.once('error', reject);
    server.once('listening', () => {
      logger.info({ port }, 'service listening');
      resolve({ server, shutdown });
    });
  });
}

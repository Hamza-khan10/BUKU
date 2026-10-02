import {
  createHttpApp,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
} from '@buku/common';
import type { Database } from '@buku/database';
import type { EventHandler } from '@buku/kafka';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { notificationHandler } from './events/handlers.js';
import { InboxService } from './inbox-service.js';
import { Notifier } from './notifier.js';
import type { PushSender } from './push/sender.js';
import { registerRoutes } from './routes/index.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface NotificationAppDeps {
  db: Database;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  push: PushSender;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildNotificationApp(deps: NotificationAppDeps): {
  app: Express;
  notifier: Notifier;
  handler: EventHandler;
} {
  const notifier = new Notifier(deps.db, deps.push);
  const app = createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        inbox: new InboxService(deps.db),
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
  return { app, notifier, handler: notificationHandler({ db: deps.db, notifier }) };
}

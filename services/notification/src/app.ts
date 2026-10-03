import {
  createHttpApp,
  type BlindIndexer,
  type FieldCipher,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
} from '@buku/common';
import type { Database } from '@buku/database';
import type { EventHandler } from '@buku/kafka';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import type { EmailSender } from './email/sender.js';
import { notificationHandler } from './events/handlers.js';
import { InboxService } from './inbox-service.js';
import { Notifier } from './notifier.js';
import type { PushSender } from './push/sender.js';
import { registerRoutes } from './routes/index.js';
import type { OpeningsFinder } from './scheduler/openings.js';
import { Scheduler } from './scheduler/scheduler.js';
import { Suggestions } from './scheduler/suggestions.js';
import { NotificationSettings } from './settings.js';
import type { WhatsAppSender } from './whatsapp/sender.js';
import { WhatsAppService } from './whatsapp/whatsapp-service.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface NotificationAppDeps {
  db: Database;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  push: PushSender;
  email: EmailSender;
  whatsapp: WhatsAppSender;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  urls: { webAppUrl: string; publicApiUrl: string };
  /** Free times shown in suggestions (booking-service). */
  openings: OpeningsFinder;
  whatsappConfig: {
    businessNumber?: string | undefined;
    templateLanguage?: string | undefined;
    /** Meta app secret + our verify token: without them the webhook is off. */
    webhook?: { appSecret: string; verifyToken: string } | undefined;
  };
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildNotificationApp(deps: NotificationAppDeps): {
  app: Express;
  notifier: Notifier;
  scheduler: Scheduler;
  suggestions: Suggestions;
  settings: NotificationSettings;
  handler: EventHandler;
} {
  const settings = new NotificationSettings(deps.db);
  const notifier = new Notifier({
    db: deps.db,
    push: deps.push,
    email: deps.email,
    whatsapp: deps.whatsapp,
    settings,
    cipher: deps.cipher,
    links: { ...deps.urls, indexer: deps.indexer },
    whatsappLanguage: deps.whatsappConfig.templateLanguage,
  });
  const whatsapp = new WhatsAppService({
    db: deps.db,
    redis: deps.redis,
    sender: deps.whatsapp,
    cipher: deps.cipher,
    indexer: deps.indexer,
    businessNumber: deps.whatsappConfig.businessNumber,
  });
  const app = createHttpApp({
    ...deps.http,
    // The WhatsApp webhook signature covers the exact bytes Meta sent.
    keepRawBody: true,
    routes: (app) =>
      registerRoutes(app, {
        inbox: new InboxService(deps.db),
        settings,
        whatsapp,
        indexer: deps.indexer,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
        whatsappWebhook: deps.whatsappConfig.webhook,
      }),
  });
  const scheduler = new Scheduler({ db: deps.db, redis: deps.redis, notifier, settings });
  return {
    app,
    notifier,
    settings,
    scheduler,
    suggestions: new Suggestions({ db: deps.db, settings, scheduler, openings: deps.openings }),
    handler: notificationHandler({ db: deps.db, notifier }),
  };
}

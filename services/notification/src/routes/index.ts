import {
  authenticate,
  rateLimit,
  requireAuth,
  sendNoContent,
  sendSuccess,
  validated,
  zBody,
  zPagination,
  zUuid,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express } from 'express';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { InboxService } from '../inbox-service.js';

export interface RouteDeps {
  inbox: InboxService;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  redis: Redis;
}

const ListQuery = zPagination.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
const IdParams = z.object({ id: zUuid });
const PrefsBody = zBody({
  pushBookingConfirmation: z.boolean().optional(),
  pushReminders: z.boolean().optional(),
  pushQueueUpdates: z.boolean().optional(),
  pushBusinessAlerts: z.boolean().optional(),
  whatsappUpdates: z.boolean().optional(),
  smsReminders: z.boolean().optional(),
  emailBookingConfirmation: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const auth = authenticate({ verifier: deps.verifier, isRevoked: (t) => deps.revocations.isRevoked(t) });
  const writeLimit = rateLimit({
    keyPrefix: 'rl:notif:write',
    points: 120,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const r = Router();
  r.use(auth);

  r.get(
    '/',
    validated({ query: ListQuery }, async ({ query }, req, res) => {
      const { items, meta } = await deps.inbox.list(requireAuth(req).userId, query);
      sendSuccess(res, items, 200, meta);
    }),
  );
  r.get('/unread-count', async (req, res) => {
    sendSuccess(res, { unread: await deps.inbox.unreadCount(requireAuth(req).userId) });
  });
  r.post('/read-all', writeLimit, async (req, res) => {
    sendSuccess(res, { marked: await deps.inbox.markAllRead(requireAuth(req).userId) });
  });
  r.post(
    '/:id/read',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      await deps.inbox.markRead(requireAuth(req).userId, params.id);
      sendNoContent(res);
    }),
  );
  r.delete(
    '/:id',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      await deps.inbox.remove(requireAuth(req).userId, params.id);
      sendNoContent(res);
    }),
  );
  app.use('/v1/notifications', r);

  app.get('/v1/users/me/notification-prefs', auth, async (req, res) => {
    sendSuccess(res, await deps.inbox.preferences(requireAuth(req).userId));
  });
  app.put(
    '/v1/users/me/notification-prefs',
    auth,
    writeLimit,
    validated({ body: PrefsBody }, async ({ body }, req, res) => {
      sendSuccess(res, await deps.inbox.updatePreferences(requireAuth(req).userId, body));
    }),
  );
}

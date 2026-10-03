import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AppError,
  authenticate,
  rateLimit,
  requireAuth,
  requireRole,
  type BlindIndexer,
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
import { checkUnsubscribeSignature, escapeHtml } from '../email/render.js';
import { requestContext } from '../http/context.js';
import { UNSUBSCRIBABLE, type InboxService } from '../inbox-service.js';
import type { NotificationSettings } from '../settings.js';
import { WHATSAPP_TEMPLATES } from '../whatsapp/templates.js';
import type { WhatsAppService } from '../whatsapp/whatsapp-service.js';

export interface RouteDeps {
  inbox: InboxService;
  settings: NotificationSettings;
  whatsapp: WhatsAppService;
  indexer: BlindIndexer;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  redis: Redis;
  /** Meta app secret and verify token; webhook answers 404 without them. */
  whatsappWebhook?: { appSecret: string; verifyToken: string } | undefined;
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
  emailReminders: z.boolean().optional(),
  emailBusinessAlerts: z.boolean().optional(),
  suggestions: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');

const UnsubscribeQuery = z.object({
  u: zUuid,
  p: z.enum(UNSUBSCRIBABLE),
  s: z.string().regex(/^[0-9a-f]{64}$/),
});
const SettingsBody = zBody({
  emailEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappPaidTypes: z.array(z.string().max(50)).max(20).optional(),
  whatsappMonthlyBudgetCents: z.number().int().min(0).max(100_000_000).optional(),
  whatsappMessageCostCents: z.number().min(0).max(1000).optional(),
  whatsappFreeWindowPerMonth: z.number().int().min(0).max(10_000_000).optional(),
  reminder24h: z.boolean().optional(),
  reminder2h: z.boolean().optional(),
  quietStartHour: z.number().int().min(0).max(23).optional(),
  quietEndHour: z.number().int().min(0).max(23).optional(),
  suggestionsEnabled: z.boolean().optional(),
  suggestionMinDays: z.number().int().min(0).max(365).optional(),
  suggestionMaxPer30Days: z.number().int().min(0).max(30).optional(),
  suggestionMaxIgnored: z.number().int().min(0).max(100).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');
const VerifyQuery = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().max(200),
  'hub.challenge': z.string().max(200),
});

const PREF_WORDS: Record<(typeof UNSUBSCRIBABLE)[number], string> = {
  emailBookingConfirmation: 'booking confirmation and change emails',
  emailReminders: 'reminder emails',
  emailBusinessAlerts: 'booking alert emails for your business',
  marketingEmails: 'news and offers emails',
};
const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const auth = authenticate({ verifier: deps.verifier, isRevoked: (t) => deps.revocations.isRevoked(t) });
  const writeLimit = rateLimit({
    keyPrefix: 'rl:notif:write',
    points: 120,
    durationSeconds: 60,
    redis: deps.redis,
  });
  // ── Unsubscribe links in emails (no sign-in; the link is signed) ─────────
  const unsubLimit = rateLimit({
    keyPrefix: 'rl:notif:unsub',
    points: 30,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const unsubscribeParams = (query: unknown) => {
    const q = UnsubscribeQuery.safeParse(query);
    if (!q.success || !checkUnsubscribeSignature(deps.indexer, q.data.u, q.data.p, q.data.s)) return null;
    return q.data;
  };
  // GET only shows a button: link scanners in mail systems must not unsubscribe people.
  app.get('/v1/notifications/unsubscribe', unsubLimit, (req, res) => {
    const q = unsubscribeParams(req.query);
    if (!q) {
      res
        .status(400)
        .type('html')
        .send(page('Link not valid', '<p>This unsubscribe link is broken or incomplete.</p>'));
      return;
    }
    const action = escapeHtml(req.originalUrl);
    res
      .type('html')
      .send(
        page(
          'Turn off these emails?',
          `<p>Stop ${escapeHtml(PREF_WORDS[q.p])}. You can turn them back on in the BUKU app’s notification settings.</p><form method="post" action="${action}"><button type="submit">Turn off</button></form>`,
        ),
      );
  });
  // One-click (RFC 8058) from the mail app, or the button above.
  app.post('/v1/notifications/unsubscribe', unsubLimit, async (req, res) => {
    const q = unsubscribeParams(req.query);
    if (!q) throw AppError.badRequest('This unsubscribe link is not valid');
    await deps.inbox.unsubscribe(q.u, q.p);
    res.type('html').send(page('Done', `<p>You won’t get ${escapeHtml(PREF_WORDS[q.p])} any more.</p>`));
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

  // ── WhatsApp: connect your number ────────────────────────────────────────
  const linkLimit = rateLimit({
    keyPrefix: 'rl:notif:wa-link',
    points: 5,
    durationSeconds: 3600,
    redis: deps.redis,
  });
  app.get('/v1/users/me/whatsapp', auth, async (req, res) => {
    sendSuccess(res, await deps.whatsapp.status(requireAuth(req).userId));
  });
  app.post('/v1/users/me/whatsapp/link', auth, linkLimit, async (req, res) => {
    sendSuccess(res, await deps.whatsapp.startLink(requireAuth(req).userId));
  });
  app.delete('/v1/users/me/whatsapp', auth, writeLimit, async (req, res) => {
    await deps.whatsapp.disconnect(requireAuth(req).userId, requestContext(req));
    sendNoContent(res);
  });

  // ── WhatsApp webhook from Meta (no sign-in; the signature is checked) ────
  const hook = deps.whatsappWebhook;
  const hookLimit = rateLimit({
    keyPrefix: 'rl:notif:wa-hook',
    points: 600,
    durationSeconds: 60,
    redis: deps.redis,
  });
  app.get('/v1/webhooks/whatsapp', hookLimit, (req, res) => {
    const q = VerifyQuery.safeParse(req.query);
    if (!hook || !q.success || !safeEqual(q.data['hub.verify_token'], hook.verifyToken)) {
      throw AppError.forbidden('Verification failed');
    }
    res.type('text/plain').send(q.data['hub.challenge']);
  });
  app.post('/v1/webhooks/whatsapp', hookLimit, async (req, res) => {
    if (!hook) throw AppError.notFound('Route');
    const raw = req.rawBody;
    const given = req.get('x-hub-signature-256') ?? '';
    const expected = raw ? `sha256=${createHmac('sha256', hook.appSecret).update(raw).digest('hex')}` : '';
    if (!raw || !safeEqual(given, expected)) throw AppError.unauthorized('Invalid signature');
    sendSuccess(res, await deps.whatsapp.handleWebhook(req.body));
  });

  // ── Platform admins: how notifications go out ───────────────────────────
  const a = Router();
  a.use(auth, requireRole('super_admin'), writeLimit);
  a.get('/settings', async (_req, res) => {
    sendSuccess(res, await deps.settings.get());
  });
  a.put(
    '/settings',
    validated({ body: SettingsBody }, async ({ body }, req, res) => {
      sendSuccess(res, await deps.settings.update(body, requireAuth(req).userId, requestContext(req)));
    }),
  );
  a.get('/whatsapp/usage', async (_req, res) => {
    sendSuccess(res, await deps.settings.whatsappUsage());
  });
  /** What to create in Meta's WhatsApp Manager before allowing paid messages. */
  a.get('/whatsapp/templates', (_req, res) => {
    sendSuccess(
      res,
      Object.entries(WHATSAPP_TEMPLATES).map(([type, t]) => ({
        type,
        name: t.name,
        category: 'UTILITY',
        example: t.example,
      })),
    );
  });
  app.use('/v1/admin/notifications', a);

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

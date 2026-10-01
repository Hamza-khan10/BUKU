import {
  authenticate,
  rateLimit,
  requireAuth,
  sendCreated,
  sendSuccess,
  validated,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express } from 'express';
import type { Redis } from 'ioredis';
import { requestContext } from '../http/context.js';
import type { QueueService } from '../queue-service.js';
import type { QueueSettingsService } from '../settings.js';
import {
  EntryParams,
  IdOrSlugParams,
  IdParams,
  JoinBody,
  PriorityBody,
  QueueSettingsBody,
  TicketParams,
  WalkInBody,
} from './schemas.js';

export interface RouteDeps {
  queue: QueueService;
  settings: QueueSettingsService;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  redis: Redis;
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const auth = authenticate({ verifier: deps.verifier, isRevoked: (t) => deps.revocations.isRevoked(t) });
  const writeLimit = rateLimit({
    keyPrefix: 'rl:queue:write',
    points: 120,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const joinLimit = rateLimit({
    keyPrefix: 'rl:queue:join',
    points: 10,
    durationSeconds: 3600,
    redis: deps.redis,
  });

  // ── Customers ────────────────────────────────────────────────────────────
  const q = Router();
  // Public: is there a queue here, and how long is it? (ticket numbers only)
  q.get(
    '/public/:idOrSlug',
    validated({ params: IdOrSlugParams }, async ({ params }, _req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, await deps.queue.publicState(params.idOrSlug));
    }),
  );
  q.post(
    '/join',
    auth,
    joinLimit,
    validated({ body: JoinBody }, async ({ body }, req, res) => {
      const { userId, role } = requireAuth(req);
      sendCreated(res, await deps.queue.join(userId, role, body, requestContext(req)));
    }),
  );
  q.get('/my-ticket', auth, async (req, res) => {
    sendSuccess(res, await deps.queue.myTicket(requireAuth(req).userId));
  });
  q.get(
    '/tickets/:id',
    auth,
    validated({ params: TicketParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.ticket(requireAuth(req).userId, params.id));
    }),
  );
  q.post(
    '/tickets/:id/leave',
    auth,
    writeLimit,
    validated({ params: TicketParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.leave(requireAuth(req).userId, params.id, requestContext(req)));
    }),
  );
  app.use('/v1/queue', q);

  // ── The front desk ───────────────────────────────────────────────────────
  const b = Router({ mergeParams: true });
  b.use(auth);
  b.get(
    '/',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.board(params.id, requireAuth(req).userId));
    }),
  );
  b.post(
    '/open',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.open(params.id, requireAuth(req).userId, requestContext(req)));
    }),
  );
  b.post(
    '/pause',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.pause(params.id, requireAuth(req).userId));
    }),
  );
  b.post(
    '/resume',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.resume(params.id, requireAuth(req).userId));
    }),
  );
  b.post(
    '/close',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.close(params.id, requireAuth(req).userId, requestContext(req)));
    }),
  );
  b.post(
    '/walk-ins',
    writeLimit,
    validated({ params: IdParams, body: WalkInBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.queue.walkIn(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  b.post(
    '/call-next',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.queue.callNext(params.id, requireAuth(req).userId, requestContext(req)));
    }),
  );
  for (const [action, method] of [
    ['call', 'call'],
    ['serve', 'serve'],
    ['complete', 'complete'],
    ['no-show', 'noShow'],
  ] as const) {
    b.post(
      `/entries/:entryId/${action}`,
      writeLimit,
      validated({ params: EntryParams }, async ({ params }, req, res) => {
        sendSuccess(
          res,
          await deps.queue[method](params.id, params.entryId, requireAuth(req).userId, requestContext(req)),
        );
      }),
    );
  }
  b.put(
    '/entries/:entryId/priority',
    writeLimit,
    validated({ params: EntryParams, body: PriorityBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.queue.setPriority(params.id, params.entryId, requireAuth(req).userId, body.priority),
      );
    }),
  );
  b.get(
    '/settings',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.settings.get(params.id, requireAuth(req).userId));
    }),
  );
  b.put(
    '/settings',
    writeLimit,
    validated({ params: IdParams, body: QueueSettingsBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.settings.update(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  app.use('/v1/businesses/:id/queue', b);
}

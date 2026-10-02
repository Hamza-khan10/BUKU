import {
  authenticate,
  rateLimit,
  requireAuth,
  requireRole,
  sendCreated,
  sendNoContent,
  sendSuccess,
  validated,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express } from 'express';
import type { Redis } from 'ioredis';
import type { AccountService } from '../account-service.js';
import type { CatalogService } from '../catalog-service.js';
import { requestContext } from '../http/context.js';
import {
  ApproveBody,
  AudienceParams,
  BusinessRequestParams,
  DeclineBody,
  PlanRequestBody,
  RequestsQuery,
  ChannelParams,
  CodeParams,
  CostBody,
  CreatePlanBody,
  EconomicsBody,
  EndBody,
  ExternalIdBody,
  FeeBody,
  GrantBody,
  IdParams,
  PriceBody,
  PricingQuery,
  SettingsBody,
  SubscriptionsQuery,
  UpdateCostBody,
  UpdatePlanBody,
} from './schemas.js';

export interface RouteDeps {
  catalog: CatalogService;
  accounts: AccountService;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  redis: Redis;
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const auth = authenticate({ verifier: deps.verifier, isRevoked: (t) => deps.revocations.isRevoked(t) });
  const writeLimit = rateLimit({
    keyPrefix: 'rl:billing:write',
    points: 20,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const adminLimit = rateLimit({
    keyPrefix: 'rl:billing:admin',
    points: 120,
    durationSeconds: 60,
    redis: deps.redis,
  });

  // ── Public and customers ─────────────────────────────────────────────────
  const b = Router();
  // The pricing page: plans on sale, their benefits, limits and features, prices on a channel.
  b.get(
    '/plans',
    validated({ query: PricingQuery }, async ({ query }, _req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=300');
      sendSuccess(res, await deps.catalog.pricing(query.audience, query.channel, query.currency));
    }),
  );
  b.get('/me', auth, async (req, res) => {
    sendSuccess(res, await deps.accounts.mine(requireAuth(req).userId));
  });
  // Start my free trial (once per account, whenever I like).
  b.post('/me/trial', auth, writeLimit, async (req, res) => {
    sendSuccess(res, await deps.accounts.startMyTrial(requireAuth(req).userId, requestContext(req)));
  });
  app.use('/v1/billing', b);

  // ── A business's plan, trial and plan requests ───────────────────────────
  const biz = Router({ mergeParams: true });
  biz.use(auth);
  biz.get(
    '/',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.accounts.business(params.id, requireAuth(req).userId));
    }),
  );
  biz.post(
    '/trial',
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.accounts.startBusinessTrial(params.id, requireAuth(req).userId, requestContext(req)),
      );
    }),
  );
  biz.get(
    '/plan-requests',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.accounts.businessRequests(params.id, requireAuth(req).userId));
    }),
  );
  biz.post(
    '/plan-requests',
    writeLimit,
    validated({ params: IdParams, body: PlanRequestBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.accounts.requestPlan(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  biz.post(
    '/plan-requests/:requestId/withdraw',
    writeLimit,
    validated({ params: BusinessRequestParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.accounts.withdrawRequest(
          params.id,
          params.requestId,
          requireAuth(req).userId,
          requestContext(req),
        ),
      );
    }),
  );
  app.use('/v1/businesses/:id/billing', biz);

  // ── Platform admins: the whole catalog is editable at any time ───────────
  const a = Router();
  a.use(auth, requireRole('super_admin'), adminLimit);
  const admin = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;

  a.get('/plans', async (_req, res) => {
    sendSuccess(res, await deps.catalog.listPlans());
  });
  a.post(
    '/plans',
    validated({ body: CreatePlanBody }, async ({ body }, req, res) => {
      sendCreated(res, await deps.catalog.createPlan(body, admin(req), requestContext(req)));
    }),
  );
  a.patch(
    '/plans/:code',
    validated({ params: CodeParams, body: UpdatePlanBody }, async ({ params, body }, req, res) => {
      sendSuccess(res, await deps.catalog.updatePlan(params.code, body, admin(req), requestContext(req)));
    }),
  );
  a.post(
    '/plans/:code/archive',
    validated({ params: CodeParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.catalog.archivePlan(params.code, admin(req), requestContext(req)));
    }),
  );
  a.post(
    '/plans/:code/restore',
    validated({ params: CodeParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.catalog.restorePlan(params.code, admin(req), requestContext(req)));
    }),
  );
  a.post(
    '/plans/:code/prices',
    validated({ params: CodeParams, body: PriceBody }, async ({ params, body }, req, res) => {
      sendCreated(res, await deps.catalog.setPrice(params.code, body, admin(req), requestContext(req)));
    }),
  );
  a.post(
    '/prices/:id/archive',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.catalog.archivePrice(params.id, admin(req), requestContext(req)));
    }),
  );
  a.put(
    '/prices/:id/external-id',
    validated({ params: IdParams, body: ExternalIdBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.catalog.setExternalPriceId(
          params.id,
          body.externalPriceId,
          admin(req),
          requestContext(req),
        ),
      );
    }),
  );

  a.get('/settings', async (_req, res) => {
    sendSuccess(res, await deps.catalog.getSettings());
  });
  a.put(
    '/settings/:audience',
    validated({ params: AudienceParams, body: SettingsBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.catalog.updateSettings(params.audience, body, admin(req), requestContext(req)),
      );
    }),
  );

  a.get('/costs', async (_req, res) => {
    sendSuccess(res, await deps.catalog.listCosts());
  });
  a.post(
    '/costs',
    validated({ body: CostBody }, async ({ body }, req, res) => {
      sendCreated(res, await deps.catalog.addCost(body, admin(req), requestContext(req)));
    }),
  );
  a.patch(
    '/costs/:id',
    validated({ params: IdParams, body: UpdateCostBody }, async ({ params, body }, req, res) => {
      sendSuccess(res, await deps.catalog.updateCost(params.id, body, admin(req), requestContext(req)));
    }),
  );
  a.delete(
    '/costs/:id',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      await deps.catalog.removeCost(params.id, admin(req), requestContext(req));
      sendNoContent(res);
    }),
  );
  a.get('/fees', async (_req, res) => {
    sendSuccess(res, await deps.catalog.listFees());
  });
  a.put(
    '/fees/:channel',
    validated({ params: ChannelParams, body: FeeBody }, async ({ params, body }, req, res) => {
      sendSuccess(res, await deps.catalog.setFee(params.channel, body, admin(req), requestContext(req)));
    }),
  );
  a.post(
    '/economics',
    validated({ body: EconomicsBody }, async ({ body }, _req, res) => {
      sendSuccess(res, await deps.catalog.economics(body));
    }),
  );

  a.get(
    '/subscriptions',
    validated({ query: SubscriptionsQuery }, async ({ query }, _req, res) => {
      const { items, meta } = await deps.accounts.list(query);
      sendSuccess(res, items, 200, meta);
    }),
  );
  a.post(
    '/grants',
    validated({ body: GrantBody }, async ({ body }, req, res) => {
      sendCreated(res, await deps.accounts.grant(body, admin(req), requestContext(req)));
    }),
  );
  a.post(
    '/subscriptions/:id/end',
    validated({ params: IdParams, body: EndBody }, async ({ params, body }, req, res) => {
      sendSuccess(res, await deps.accounts.end(params.id, admin(req), body.reason, requestContext(req)));
    }),
  );
  a.get(
    '/plan-requests',
    validated({ query: RequestsQuery }, async ({ query }, _req, res) => {
      sendSuccess(res, await deps.accounts.listRequests(query.status));
    }),
  );
  a.post(
    '/plan-requests/:id/approve',
    validated({ params: IdParams, body: ApproveBody }, async ({ params, body }, req, res) => {
      sendSuccess(res, await deps.accounts.approveRequest(params.id, admin(req), body, requestContext(req)));
    }),
  );
  a.post(
    '/plan-requests/:id/decline',
    validated({ params: IdParams, body: DeclineBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.accounts.declineRequest(params.id, admin(req), body.note, requestContext(req)),
      );
    }),
  );
  app.use('/v1/admin/billing', a);
}

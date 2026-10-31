import {
  AppError,
  authenticate,
  ErrorCodes,
  rateLimit,
  requireActor,
  requireRole,
  sendCreated,
  sendNoContent,
  sendSuccess,
  validated,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import type { DataPlane } from '@buku/database';
import { Router, type Express } from 'express';
import type { Redis } from 'ioredis';
import type { AccountService } from '../account-service.js';
import type { CatalogService } from '../catalog-service.js';
import type { StoreService } from '../store-service.js';
import { requestContext } from '../http/context.js';
import {
  ApproveBody,
  ChangePlanBody,
  CheckoutBody,
  AudienceParams,
  BusinessParams,
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
  plane: DataPlane;
  catalog: CatalogService;
  accounts: AccountService;
  store: StoreService;
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

  /** The business in the URL, by its public ID (DB-042): unknown is "not found". */
  const businessOf = async (publicId: string) => {
    const id = await deps.plane.idOfPublic('business', publicId);
    if (id === null) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return id;
  };

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
    sendSuccess(res, await deps.accounts.mine(requireActor(req).id));
  });
  // Customers are free (D-101): there is no trial to start (409).
  b.post('/me/trial', auth, writeLimit, async (req, res) => {
    requireActor(req);
    sendSuccess(res, await deps.accounts.startMyTrial());
  });
  // Paying online (Paddle). The customer's own paid plan:
  b.post(
    '/checkout',
    auth,
    writeLimit,
    deps.plane.switches.guard('payments'),
    validated({ body: CheckoutBody }, async ({ body }, req, res) => {
      const actor = requireActor(req);
      sendCreated(
        res,
        await deps.store.checkout({ userId: actor.id }, body.planCode, actor, requestContext(req)),
      );
    }),
  );
  b.post('/me/subscription/cancel', auth, writeLimit, async (req, res) => {
    const actor = requireActor(req);
    sendSuccess(res, await deps.store.cancel({ userId: actor.id }, actor, requestContext(req)));
  });
  b.post('/me/subscription/undo-cancel', auth, writeLimit, async (req, res) => {
    const actor = requireActor(req);
    sendSuccess(res, await deps.store.undoCancel({ userId: actor.id }, actor, requestContext(req)));
  });
  b.post(
    '/me/subscription/change',
    auth,
    writeLimit,
    deps.plane.switches.guard('payments'),
    validated({ body: ChangePlanBody }, async ({ body }, req, res) => {
      const actor = requireActor(req);
      sendSuccess(
        res,
        await deps.store.changePlan({ userId: actor.id }, body.planCode, actor, requestContext(req)),
      );
    }),
  );
  b.get('/me/subscription/portal', auth, async (req, res) => {
    const actor = requireActor(req);
    sendSuccess(res, await deps.store.portal({ userId: actor.id }, actor));
  });

  // Paddle's signed notifications (no sign-in: the signature is the authentication).
  b.post('/webhooks/paddle', async (req, res) => {
    sendSuccess(res, await deps.store.webhook(req.rawBody, req.get('paddle-signature')));
  });
  app.use('/v1/billing', b);

  // ── A business's plan, trial and plan requests ───────────────────────────
  const biz = Router({ mergeParams: true });
  biz.use(auth);
  biz.get(
    '/',
    validated({ params: BusinessParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.accounts.business(await businessOf(params.id), requireActor(req)));
    }),
  );
  biz.post(
    '/trial',
    writeLimit,
    deps.plane.switches.guard('payments'),
    validated({ params: BusinessParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.accounts.startBusinessTrial(
          await businessOf(params.id),
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  biz.get(
    '/plan-requests',
    validated({ params: BusinessParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.accounts.businessRequests(await businessOf(params.id), requireActor(req)));
    }),
  );
  biz.post(
    '/plan-requests',
    writeLimit,
    validated({ params: BusinessParams, body: PlanRequestBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.accounts.requestPlan(
          await businessOf(params.id),
          requireActor(req),
          body,
          requestContext(req),
        ),
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
          await businessOf(params.id),
          params.requestId,
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  biz.post(
    '/checkout',
    writeLimit,
    deps.plane.switches.guard('payments'),
    validated({ params: BusinessParams, body: CheckoutBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.store.checkout(
          { businessId: await businessOf(params.id) },
          body.planCode,
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  biz.post(
    '/subscription/cancel',
    writeLimit,
    validated({ params: BusinessParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.store.cancel(
          { businessId: await businessOf(params.id) },
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  biz.post(
    '/subscription/undo-cancel',
    writeLimit,
    validated({ params: BusinessParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.store.undoCancel(
          { businessId: await businessOf(params.id) },
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  biz.post(
    '/subscription/change',
    writeLimit,
    validated({ params: BusinessParams, body: ChangePlanBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.store.changePlan(
          { businessId: await businessOf(params.id) },
          body.planCode,
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  biz.get(
    '/subscription/portal',
    validated({ params: BusinessParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.store.portal({ businessId: await businessOf(params.id) }, requireActor(req)),
      );
    }),
  );
  app.use('/v1/businesses/:id/billing', biz);

  // ── Platform admins: the whole catalog is editable at any time ───────────
  const a = Router();
  a.use(auth, requireRole('super_admin'), adminLimit);
  const admin = (req: Parameters<typeof requireActor>[0]) => requireActor(req).id;

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
  a.post(
    '/prices/:id/sync-paddle',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.store.syncPrice(params.id, admin(req), requestContext(req)));
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
      // Paddle subscriptions are cancelled in Paddle (immediately); grants and trials here.
      const provider = await deps.accounts.providerOf(params.id);
      sendSuccess(
        res,
        provider === 'paddle'
          ? await deps.store.endNow(params.id, admin(req), body.reason, requestContext(req))
          : await deps.accounts.end(params.id, admin(req), body.reason, requestContext(req)),
      );
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

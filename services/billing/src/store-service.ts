import { AppError, ErrorCodes, logger, recordSecurityEvent, type Actor } from '@buku/common';
import {
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';
import type { PaddleClient, PaddleSubscription } from './paddle/client.js';
import { verifyPaddleSignature } from './paddle/signature.js';
import { auditByPerson, exponents, LIVE, money } from './shared.js';

/**
 * Paying on the web with Paddle (D-069). Paddle is the merchant of record: it
 * shows the checkout, collects the payment and the sales tax/VAT, and tells
 * us what happened through signed webhooks. BUKU never sees card details.
 *
 *  1. checkout: we create a Paddle transaction for the plan's web price, with
 *     the business in `custom_data` (set by us, server-side — the browser
 *     can't change who the payment is for), and the app opens Paddle.js on it;
 *  2. Paddle sends `subscription.*` webhooks: we verify the signature, process
 *     each event once, ignore events older than what we already applied, and
 *     record the subscription — it then decides the business's plan;
 *  3. owners cancel (at the end of the paid period), undo that, switch
 *     plans (prorated) or update their card in Paddle's portal.
 *
 * A paid subscription replaces a running trial or grant. Prices are linked to
 * Paddle by syncing them (admin), which creates the product and price there.
 * Customers use BUKU for free (D-101): there is nothing for them to buy.
 *
 * Database v2 (D3g): a subscription lives on its business's shard, named in `custom_data` by the
 * business's public ID (DB-042); a webhook is recorded as handled and applied in one transaction
 * there. Prices and plans are reference data on the directory.
 */

export interface PaddleConfig {
  environment: 'sandbox' | 'production';
  clientToken: string;
  webhookSecret: string;
  webhookToleranceSeconds: number;
  taxCategory: string;
}

/** Who pays: a business (by internal ID), or a customer (refused: they're free). */
export type Payer = { businessId: bigint } | { userId: bigint };

const STATUS: Record<
  PaddleSubscription['status'],
  'active' | 'trialing' | 'past_due' | 'paused' | 'cancelled'
> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'cancelled',
};
const CONSUMER = 'billing-paddle-webhooks';

export class StoreService {
  private readonly log = logger.child({ module: 'billing-store' });

  constructor(
    private readonly plane: DataPlane,
    /** null when Paddle isn't configured: checkout is unavailable, nothing else changes. */
    private readonly paddle: PaddleClient | null,
    private readonly config: PaddleConfig | null,
  ) {}

  // ── Business owners ──────────────────────────────────────────────────────

  async checkout(payer: Payer, planCode: string, actor: Actor, ctx: RequestContext) {
    // Who may do this first: an outsider learns nothing, not even whether payments are set up.
    await this.authorize(payer, actor);
    const { paddle, config } = this.require();
    const audience = 'businessId' in payer ? 'business' : 'user';
    const settings = await this.plane.directory.billingSettings.findUnique({ where: { audience } });
    if (!settings?.enabled || !('businessId' in payer))
      throw new AppError('Everything is included right now', ErrorCodes.CONFLICT, 409);
    const plan = await this.plane.directory.plan.findUnique({
      where: { code: planCode },
      include: { prices: { where: { channel: 'web', archivedAt: null, externalPriceId: { not: null } } } },
    });
    if (!plan || plan.audience !== audience || plan.archivedAt || !plan.isPublic)
      throw AppError.notFound('Plan');
    const price = plan.prices.find((p) => p.currency === 'USD') ?? plan.prices[0];
    if (!price?.externalPriceId) {
      throw new AppError('This plan can’t be bought online yet', ErrorCodes.FEATURE_DISABLED, 409);
    }
    const { businessId } = payer;
    const publicId = await this.plane.inBusiness(businessId, async (tx) => {
      if (await liveStoreSubscription(tx, businessId))
        throw AppError.conflict('You already have a paid plan; change it instead of buying another');
      return (await tx.business.findUniqueOrThrow({ where: { id: businessId } })).publicId;
    });

    const transaction = await paddle.createTransaction(price.externalPriceId, {
      buku_account_type: audience,
      buku_account_id: publicId,
      buku_plan: plan.code,
    });
    await this.plane.inBusiness(businessId, (tx) =>
      recordShardAudit(tx, this.plane.id(), {
        userId: actor.id,
        action: 'billing.checkout_started',
        resourceType: 'plan_price',
        resourceId: price.id,
        newValues: { plan: plan.code, transaction: transaction.id },
        ...auditCtx(ctx),
      }),
    );
    const exp = await exponents(this.plane.directory);
    return {
      /** Open with Paddle.js: Paddle.Initialize({ token: clientToken }) then Paddle.Checkout.open({ transactionId }). */
      transactionId: transaction.id,
      checkoutUrl: transaction.checkoutUrl,
      clientToken: config.clientToken,
      environment: config.environment,
      plan: { code: plan.code, name: plan.name },
      price: {
        amount: money(price.amountMinor, price.currency, exp),
        currency: price.currency,
        interval: price.interval,
      },
    };
  }

  /** Cancel at the end of the paid period (access continues until then). */
  async cancel(payer: Payer, actor: Actor, ctx: RequestContext) {
    const owner = await this.authorize(payer, actor);
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(owner);
    const { businessId } = sub;
    await this.applyTo(
      businessId,
      await paddle.cancelSubscription(sub.externalSubscriptionId!, 'next_billing_period'),
    );
    await this.audit(businessId, actor.id, 'billing.subscription_cancel_scheduled', sub.id, ctx);
    return this.view(businessId, sub.id);
  }

  async undoCancel(payer: Payer, actor: Actor, ctx: RequestContext) {
    const owner = await this.authorize(payer, actor);
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(owner);
    const { businessId } = sub;
    if (!sub.cancelAtPeriodEnd) return this.view(businessId, sub.id);
    await this.applyTo(businessId, await paddle.removeScheduledChange(sub.externalSubscriptionId!));
    await this.audit(businessId, actor.id, 'billing.subscription_cancel_undone', sub.id, ctx);
    return this.view(businessId, sub.id);
  }

  /** Switch to another plan now (prorated). */
  async changePlan(payer: Payer, planCode: string, actor: Actor, ctx: RequestContext) {
    const owner = await this.authorize(payer, actor);
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(owner);
    const { businessId } = sub;
    const plan = await this.plane.directory.plan.findUnique({
      where: { code: planCode },
      include: { prices: { where: { channel: 'web', archivedAt: null, externalPriceId: { not: null } } } },
    });
    if (!plan || plan.audience !== 'business' || plan.archivedAt || !plan.isPublic)
      throw AppError.notFound('Plan');
    if (plan.id === sub.planId) return this.view(businessId, sub.id);
    const price = plan.prices.find((p) => p.currency === 'USD') ?? plan.prices[0];
    if (!price?.externalPriceId)
      throw new AppError('This plan can’t be bought online yet', ErrorCodes.FEATURE_DISABLED, 409);
    await this.applyTo(
      businessId,
      await paddle.changePrice(sub.externalSubscriptionId!, price.externalPriceId),
    );
    await this.audit(businessId, actor.id, 'billing.plan_changed', sub.id, ctx, { to: plan.code });
    return this.view(businessId, sub.id);
  }

  /** Links into Paddle's portal: update the card, see invoices. */
  async portal(payer: Payer, actor: Actor) {
    const owner = await this.authorize(payer, actor);
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(owner);
    return paddle.portalLinks(sub.externalCustomerId!, sub.externalSubscriptionId!);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /** End a Paddle subscription right away (refunds, if any, are done in Paddle). */
  async endNow(subscriptionId: bigint, adminId: bigint, reason: string, ctx: RequestContext) {
    const { paddle } = this.require();
    const sub = (
      await this.plane.acrossBusinesses((tx) => tx.subscription.findFirst({ where: { id: subscriptionId } }))
    ).find(Boolean);
    if (sub?.provider !== 'paddle' || !sub.externalSubscriptionId)
      throw AppError.notFound('Paddle subscription');
    await this.applyTo(
      sub.businessId,
      await paddle.cancelSubscription(sub.externalSubscriptionId, 'immediately'),
    );
    await this.audit(sub.businessId, adminId, 'billing.subscription_ended', sub.id, ctx, { reason });
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'admin.subscription_ended',
      resourceType: 'subscription',
      resourceId: sub.id,
      newValues: { reason, provider: 'paddle' },
    });
    return this.view(sub.businessId, sub.id);
  }

  /** Create the plan's product and this price in Paddle, and link them (on the directory). */
  async syncPrice(priceId: bigint, adminId: bigint, ctx: RequestContext) {
    const { paddle, config } = this.require();
    const dir = this.plane.directory;
    const price = await dir.planPrice.findUnique({ where: { id: priceId }, include: { plan: true } });
    if (!price) throw AppError.notFound('Price');
    if (price.channel !== 'web') throw AppError.badRequest('Only web prices are sold through Paddle');
    if (price.archivedAt) throw AppError.conflict('This price is archived');
    if (price.externalPriceId)
      return { priceId: price.id.toString(), externalPriceId: price.externalPriceId, created: false };

    const exp = await exponents(dir);
    let productId = price.plan.externalProductId;
    if (!productId) {
      productId = await paddle.createProduct({
        name: `BUKU ${price.plan.name}`,
        description: price.plan.tagline,
        taxCategory: config.taxCategory,
      });
      await dir.plan.update({ where: { id: price.plan.id }, data: { externalProductId: productId } });
    }
    const externalPriceId = await paddle.createPrice({
      productId,
      description: `${price.plan.code} ${price.currency} ${money(price.amountMinor, price.currency, exp)}/${price.interval}`,
      // Paddle takes amounts in the currency's minor unit, as BUKU keeps them (DB-009).
      amountCents: Number(price.amountMinor),
      currency: price.currency,
      interval: price.interval as 'month' | 'year',
      trialDays: price.trialDays,
      taxInclusive: price.taxInclusive,
    });
    await dir.planPrice.update({ where: { id: price.id }, data: { externalPriceId } });
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'billing.price_synced',
      resourceType: 'plan_price',
      resourceId: price.id,
      newValues: { externalPriceId, productId },
    });
    return { priceId: price.id.toString(), externalPriceId, created: true };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  /**
   * A signed notification from Paddle. Invalid signatures are refused (401);
   * everything else is acknowledged (200) so Paddle stops retrying — events we
   * can't use are logged, never half-applied.
   */
  async webhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ processed: boolean }> {
    const { config } = this.require();
    const check = verifyPaddleSignature(
      rawBody ?? Buffer.alloc(0),
      signature,
      config.webhookSecret,
      config.webhookToleranceSeconds,
    );
    if (!check.ok) {
      this.log.warn({ reason: check.reason }, 'Paddle webhook refused');
      recordSecurityEvent('webhook_signature_invalid');
      throw new AppError('Invalid signature', ErrorCodes.WEBHOOK_SIGNATURE_INVALID, 401);
    }
    const event = JSON.parse(rawBody!.toString('utf8')) as {
      event_id?: string;
      event_type?: string;
      occurred_at?: string;
      data?: unknown;
    };
    if (typeof event.event_id !== 'string' || typeof event.event_type !== 'string') {
      throw AppError.badRequest('Not a Paddle notification');
    }
    if (!event.event_type.startsWith('subscription.')) {
      this.log.info({ eventType: event.event_type }, 'Paddle event not used');
      return { processed: true };
    }
    const s = event.data as PaddleSubscription;
    const businessId = await this.businessOf(s);
    if (businessId === null) {
      this.log.error({ subscription: s.id }, 'Paddle subscription without a BUKU business in custom_data');
      return { processed: true };
    }
    // Each event once, even if Paddle delivers it again: recorded and applied in one transaction.
    const occurredAt =
      event.occurred_at && !Number.isNaN(Date.parse(event.occurred_at))
        ? event.occurred_at
        : new Date().toISOString();
    return this.plane.inBusiness(businessId, async (tx) => {
      // The ledger is kept by the event's time; a redelivery is also caught by its ID alone.
      const seen = await tx.processedEvent.findFirst({
        where: { consumer: CONSUMER, eventId: event.event_id! },
        select: { eventId: true },
      });
      if (seen) return { processed: false };
      const fresh = await tx.$executeRaw`
        INSERT INTO processed_events (consumer, event_id, occurred_at)
        VALUES (${CONSUMER}, ${event.event_id}, ${new Date(occurredAt)}) ON CONFLICT DO NOTHING`;
      if (fresh === 0) return { processed: false };
      await this.apply(tx, businessId, s);
      return { processed: true };
    });
  }

  /**
   * Record a Paddle subscription as it is now, on its business's shard. Out-of-order updates
   * (older than the last one applied) are ignored. Unknown prices are logged and skipped (an
   * admin links the price, Paddle retries or the next event carries it).
   */
  private async apply(tx: BusinessTx, businessId: bigint, s: PaddleSubscription): Promise<void> {
    const priceId = s.items[0]?.price.id;
    const price = priceId
      ? await this.plane.directory.planPrice.findUnique({
          where: { externalPriceId: priceId },
          include: { plan: true },
        })
      : null;
    if (!price || price.plan.audience !== 'business') {
      this.log.error(
        { subscription: s.id, price: priceId },
        'Paddle subscription for a price BUKU doesn’t sell',
      );
      return;
    }
    const updatedAt = new Date(s.updated_at);
    const data = {
      planId: price.planId,
      priceId: price.id,
      status: STATUS[s.status],
      externalCustomerId: s.customer_id,
      currentPeriodStart: s.current_billing_period ? new Date(s.current_billing_period.starts_at) : null,
      currentPeriodEnd: s.current_billing_period ? new Date(s.current_billing_period.ends_at) : null,
      cancelAtPeriodEnd: s.scheduled_change?.action === 'cancel',
      cancelledAt: s.canceled_at ? new Date(s.canceled_at) : null,
      providerUpdatedAt: updatedAt,
    };
    const existing = await tx.subscription.findFirst({ where: { externalSubscriptionId: s.id, businessId } });
    if (existing) {
      if (existing.providerUpdatedAt && existing.providerUpdatedAt > updatedAt) return; // older news
      await tx.subscription.update({ where: { id: existing.id }, data });
      return;
    }
    // A paid plan replaces a running trial or grant.
    if (data.status !== 'cancelled') {
      await tx.subscription.updateMany({
        where: { businessId, provider: { in: ['trial', 'manual'] }, status: { in: [...LIVE] } },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
    }
    const sub = await tx.subscription.create({
      data: {
        ...data,
        id: this.plane.id(),
        businessId,
        provider: 'paddle',
        channel: 'web',
        externalSubscriptionId: s.id,
      },
    });
    await recordShardAudit(tx, this.plane.id(), {
      action: 'billing.subscription_started',
      resourceType: 'subscription',
      resourceId: sub.id,
      newValues: { provider: 'paddle', plan: price.plan.code },
    });
  }

  /** Apply what Paddle answered to a change we asked for, on the business's shard. */
  private applyTo(businessId: bigint, s: PaddleSubscription) {
    return this.plane.inBusiness(businessId, (tx) => this.apply(tx, businessId, s));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private require() {
    if (!this.paddle || !this.config) {
      throw new AppError('Online payments aren’t set up yet', ErrorCodes.FEATURE_DISABLED, 503);
    }
    return { paddle: this.paddle, config: this.config };
  }

  /**
   * The business may be paid for by this person (billing.manage); a customer acts only for
   * themselves, and has nothing paid for (D-101): null.
   */
  private async authorize(payer: Payer, actor: Actor): Promise<bigint | null> {
    if ('userId' in payer) {
      if (payer.userId !== actor.id) throw AppError.forbidden();
      return null;
    }
    await this.plane.inBusiness(payer.businessId, (tx) =>
      requireBusinessPermissionOnShard(tx, payer.businessId, actor, 'billing.manage'),
    );
    return payer.businessId;
  }

  /** Call after `authorize`. */
  private async ownStoreSubscription(businessId: bigint | null) {
    if (businessId === null) throw AppError.notFound('Paid subscription');
    const sub = await this.plane.inBusiness(businessId, (tx) => liveStoreSubscription(tx, businessId));
    if (!sub?.externalSubscriptionId) throw AppError.notFound('Paid subscription');
    return sub;
  }

  /**
   * The business a Paddle subscription pays for: named in `custom_data` (by us, at checkout), or
   * — for one already recorded — the shard that holds it.
   */
  private async businessOf(s: PaddleSubscription): Promise<bigint | null> {
    const custom = s.custom_data;
    if (custom?.buku_account_type === 'business' && typeof custom.buku_account_id === 'string') {
      const id = await this.plane.idOfPublic('business', custom.buku_account_id);
      if (id !== null) return id;
    }
    const known = (
      await this.plane.acrossBusinesses((tx) =>
        tx.subscription.findFirst({ where: { externalSubscriptionId: s.id }, select: { businessId: true } }),
      )
    ).find(Boolean);
    return known?.businessId ?? null;
  }

  private async view(businessId: bigint, id: bigint) {
    const s = await this.plane.inBusiness(businessId, (tx) =>
      tx.subscription.findUniqueOrThrow({ where: { id } }),
    );
    const plan = await this.plane.directory.plan.findUnique({ where: { id: s.planId } });
    return {
      id: s.id.toString(),
      plan: { code: plan?.code ?? 'unknown', name: plan?.name ?? 'Unknown plan' },
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    };
  }

  private audit(
    businessId: bigint,
    userId: bigint,
    action: string,
    resourceId: bigint,
    ctx: RequestContext,
    newValues: Record<string, string> = {},
  ) {
    return this.plane.inBusiness(businessId, (tx) =>
      recordShardAudit(tx, this.plane.id(), {
        userId,
        action,
        resourceType: 'subscription',
        resourceId,
        newValues,
        ...auditCtx(ctx),
      }),
    );
  }
}

function liveStoreSubscription(tx: BusinessTx, businessId: bigint) {
  return tx.subscription.findFirst({
    where: { businessId, provider: 'paddle', status: { in: [...LIVE] } },
  });
}

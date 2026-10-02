import type { Account, Audience } from '@buku/billing';
import { AppError, ErrorCodes, logger } from '@buku/common';
import { recordAudit, requireBusinessPermission, type Database, type Transaction } from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';
import type { PaddleClient, PaddleSubscription } from './paddle/client.js';
import { verifyPaddleSignature } from './paddle/signature.js';

/**
 * Paying on the web with Paddle (D-069). Paddle is the merchant of record: it
 * shows the checkout, collects the payment and the sales tax/VAT, and tells
 * us what happened through signed webhooks. BUKU never sees card details.
 *
 *  1. checkout: we create a Paddle transaction for the plan's web price, with
 *     the BUKU account in `custom_data` (set by us, server-side — the browser
 *     can't change who the payment is for), and the app opens Paddle.js on it;
 *  2. Paddle sends `subscription.*` webhooks: we verify the signature, process
 *     each event once, ignore events older than what we already applied, and
 *     record the subscription — it then decides the account's plan;
 *  3. customers cancel (at the end of the paid period), undo that, switch
 *     plans (prorated) or update their card in Paddle's portal.
 *
 * A paid subscription replaces a running trial or grant. Prices are linked to
 * Paddle by syncing them (admin), which creates the product and price there.
 */

export interface PaddleConfig {
  environment: 'sandbox' | 'production';
  clientToken: string;
  webhookSecret: string;
  webhookToleranceSeconds: number;
  taxCategory: string;
}

const LIVE = ['active', 'trialing', 'past_due', 'paused'] as const;
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
    private readonly db: Database,
    /** null when Paddle isn't configured: checkout is unavailable, nothing else changes. */
    private readonly paddle: PaddleClient | null,
    private readonly config: PaddleConfig | null,
  ) {}

  // ── Customers and business owners ────────────────────────────────────────

  async checkout(account: Account, planCode: string, actorId: string, ctx: RequestContext) {
    const { paddle, config } = this.require();
    const audience = audienceOf(account);
    await this.authorize(account, actorId);
    const settings = await this.db.billingSettings.findUnique({ where: { audience } });
    if (!settings?.enabled) throw new AppError('Everything is included right now', ErrorCodes.CONFLICT, 409);
    const plan = await this.db.plan.findUnique({
      where: { code: planCode },
      include: { prices: { where: { channel: 'web', archivedAt: null, externalPriceId: { not: null } } } },
    });
    if (!plan || plan.audience !== audience || plan.archivedAt || !plan.isPublic)
      throw AppError.notFound('Plan');
    const price = plan.prices.find((p) => p.currency === 'USD') ?? plan.prices[0];
    if (!price?.externalPriceId) {
      throw new AppError('This plan can’t be bought online yet', ErrorCodes.FEATURE_DISABLED, 409);
    }
    const store = await this.liveStoreSubscription(account);
    if (store) throw AppError.conflict('You already have a paid plan; change it instead of buying another');

    const transaction = await paddle.createTransaction(price.externalPriceId, {
      buku_account_type: audience,
      buku_account_id: 'userId' in account ? account.userId : account.businessId,
      buku_plan: plan.code,
    });
    await recordAudit(this.db, {
      userId: actorId,
      action: 'billing.checkout_started',
      resourceType: 'plan_price',
      resourceId: price.id,
      newValues: { plan: plan.code, ...account, transaction: transaction.id },
      ...auditCtx(ctx),
    });
    return {
      /** Open with Paddle.js: Paddle.Initialize({ token: clientToken }) then Paddle.Checkout.open({ transactionId }). */
      transactionId: transaction.id,
      checkoutUrl: transaction.checkoutUrl,
      clientToken: config.clientToken,
      environment: config.environment,
      plan: { code: plan.code, name: plan.name },
      price: { amount: price.amount.toFixed(2), currency: price.currency, interval: price.interval },
    };
  }

  /** Cancel at the end of the paid period (access continues until then). */
  async cancel(account: Account, actorId: string, ctx: RequestContext) {
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(account, actorId);
    await this.apply(await paddle.cancelSubscription(sub.externalSubscriptionId!, 'next_billing_period'));
    await this.audit(actorId, 'billing.subscription_cancel_scheduled', sub.id, ctx);
    return this.view(sub.id);
  }

  async undoCancel(account: Account, actorId: string, ctx: RequestContext) {
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(account, actorId);
    if (!sub.cancelAtPeriodEnd) return this.view(sub.id);
    await this.apply(await paddle.removeScheduledChange(sub.externalSubscriptionId!));
    await this.audit(actorId, 'billing.subscription_cancel_undone', sub.id, ctx);
    return this.view(sub.id);
  }

  /** Switch to another plan now (prorated). */
  async changePlan(account: Account, planCode: string, actorId: string, ctx: RequestContext) {
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(account, actorId);
    const plan = await this.db.plan.findUnique({
      where: { code: planCode },
      include: { prices: { where: { channel: 'web', archivedAt: null, externalPriceId: { not: null } } } },
    });
    if (!plan || plan.audience !== audienceOf(account) || plan.archivedAt || !plan.isPublic)
      throw AppError.notFound('Plan');
    if (plan.id === sub.planId) return this.view(sub.id);
    const price = plan.prices.find((p) => p.currency === 'USD') ?? plan.prices[0];
    if (!price?.externalPriceId)
      throw new AppError('This plan can’t be bought online yet', ErrorCodes.FEATURE_DISABLED, 409);
    await this.apply(await paddle.changePrice(sub.externalSubscriptionId!, price.externalPriceId));
    await this.audit(actorId, 'billing.plan_changed', sub.id, ctx, { to: plan.code });
    return this.view(sub.id);
  }

  /** Links into Paddle's portal: update the card, see invoices. */
  async portal(account: Account, actorId: string) {
    const { paddle } = this.require();
    const sub = await this.ownStoreSubscription(account, actorId);
    return paddle.portalLinks(sub.externalCustomerId!, sub.externalSubscriptionId!);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /** End a Paddle subscription right away (refunds, if any, are done in Paddle). */
  async endNow(subscriptionId: string, adminId: string, reason: string, ctx: RequestContext) {
    const { paddle } = this.require();
    const sub = await this.db.subscription.findUnique({ where: { id: subscriptionId } });
    if (sub?.provider !== 'paddle' || !sub.externalSubscriptionId)
      throw AppError.notFound('Paddle subscription');
    await this.apply(await paddle.cancelSubscription(sub.externalSubscriptionId, 'immediately'));
    await this.audit(adminId, 'billing.subscription_ended', sub.id, ctx, { reason });
    return this.view(sub.id);
  }

  /** Create the plan's product and this price in Paddle, and link them. */
  async syncPrice(priceId: string, adminId: string, ctx: RequestContext) {
    const { paddle, config } = this.require();
    const price = await this.db.planPrice.findUnique({ where: { id: priceId }, include: { plan: true } });
    if (!price) throw AppError.notFound('Price');
    if (price.channel !== 'web') throw AppError.badRequest('Only web prices are sold through Paddle');
    if (price.archivedAt) throw AppError.conflict('This price is archived');
    if (price.externalPriceId)
      return { priceId: price.id, externalPriceId: price.externalPriceId, created: false };

    let productId = price.plan.externalProductId;
    if (!productId) {
      productId = await paddle.createProduct({
        name: `BUKU ${price.plan.name}`,
        description: price.plan.tagline,
        taxCategory: config.taxCategory,
      });
      await this.db.plan.update({ where: { id: price.plan.id }, data: { externalProductId: productId } });
    }
    const externalPriceId = await paddle.createPrice({
      productId,
      description: `${price.plan.code} ${price.currency} ${price.amount.toFixed(2)}/${price.interval}`,
      amountCents: Math.round(price.amount.toNumber() * 100),
      currency: price.currency,
      interval: price.interval,
      trialDays: price.trialDays,
      taxInclusive: price.taxInclusive,
    });
    await this.db.planPrice.update({ where: { id: price.id }, data: { externalPriceId } });
    await recordAudit(this.db, {
      userId: adminId,
      action: 'billing.price_synced',
      resourceType: 'plan_price',
      resourceId: price.id,
      newValues: { externalPriceId, productId },
      ...auditCtx(ctx),
    });
    return { priceId: price.id, externalPriceId, created: true };
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
      throw new AppError('Invalid signature', ErrorCodes.WEBHOOK_SIGNATURE_INVALID, 401);
    }
    const event = JSON.parse(rawBody!.toString('utf8')) as {
      event_id?: string;
      event_type?: string;
      data?: unknown;
    };
    if (typeof event.event_id !== 'string' || typeof event.event_type !== 'string') {
      throw AppError.badRequest('Not a Paddle notification');
    }
    // Each event once, even if Paddle delivers it again.
    const fresh = await this.db.$executeRaw`
      INSERT INTO processed_events (consumer, event_id) VALUES (${CONSUMER}, ${event.event_id}) ON CONFLICT DO NOTHING`;
    if (fresh === 0) return { processed: false };
    try {
      if (event.event_type.startsWith('subscription.')) await this.apply(event.data as PaddleSubscription);
      else this.log.info({ eventType: event.event_type }, 'Paddle event not used');
      return { processed: true };
    } catch (err) {
      // Let Paddle retry: forget we saw it.
      await this.db
        .$executeRaw`DELETE FROM processed_events WHERE consumer = ${CONSUMER} AND event_id = ${event.event_id}`;
      throw err;
    }
  }

  /**
   * Record a Paddle subscription as it is now. Out-of-order updates (older
   * than the last one applied) are ignored. Unknown prices or accounts are
   * logged and skipped (an admin links the price, Paddle retries or the next
   * event carries it).
   */
  async apply(s: PaddleSubscription): Promise<void> {
    const priceId = s.items[0]?.price.id;
    const price = priceId
      ? await this.db.planPrice.findUnique({ where: { externalPriceId: priceId }, include: { plan: true } })
      : null;
    if (!price) {
      this.log.error(
        { subscription: s.id, price: priceId },
        'Paddle subscription for a price BUKU doesn’t know',
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

    await this.db.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({ where: { externalSubscriptionId: s.id } });
      if (existing) {
        if (existing.providerUpdatedAt && existing.providerUpdatedAt > updatedAt) return; // older news
        await tx.subscription.update({ where: { id: existing.id }, data });
        return;
      }
      const account = await this.accountFrom(tx, s.custom_data, price.plan.audience);
      if (!account) {
        this.log.error({ subscription: s.id }, 'Paddle subscription without a BUKU account in custom_data');
        return;
      }
      // A paid plan replaces a running trial or grant.
      if (data.status !== 'cancelled') {
        await tx.subscription.updateMany({
          where: { ...account, provider: { in: ['trial', 'manual'] }, status: { in: [...LIVE] } },
          data: { status: 'cancelled', cancelledAt: new Date() },
        });
      }
      await tx.subscription.create({
        data: { ...data, ...account, provider: 'paddle', channel: 'web', externalSubscriptionId: s.id },
      });
      await recordAudit(tx, {
        action: 'billing.subscription_started',
        resourceType: 'subscription',
        newValues: { provider: 'paddle', plan: price.plan.code, ...account },
      });
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private require() {
    if (!this.paddle || !this.config) {
      throw new AppError('Online payments aren’t set up yet', ErrorCodes.FEATURE_DISABLED, 503);
    }
    return { paddle: this.paddle, config: this.config };
  }

  private async authorize(account: Account, actorId: string) {
    if ('businessId' in account)
      await requireBusinessPermission(this.db, account.businessId, actorId, 'billing.manage');
    else if (account.userId !== actorId) throw AppError.forbidden();
  }

  private liveStoreSubscription(account: Account) {
    return this.db.subscription.findFirst({
      where: { ...account, provider: 'paddle', status: { in: [...LIVE] } },
    });
  }

  private async ownStoreSubscription(account: Account, actorId: string) {
    await this.authorize(account, actorId);
    const sub = await this.liveStoreSubscription(account);
    if (!sub?.externalSubscriptionId) throw AppError.notFound('Paid subscription');
    return sub;
  }

  /** The BUKU account a new Paddle subscription belongs to (set by us at checkout). */
  private async accountFrom(tx: Transaction, custom: Record<string, unknown> | null, audience: Audience) {
    const type = custom?.buku_account_type;
    const id = custom?.buku_account_id;
    if (type !== audience || typeof id !== 'string') return null;
    if (type === 'user') return (await tx.user.findUnique({ where: { id } })) ? { userId: id } : null;
    return (await tx.business.findUnique({ where: { id } })) ? { businessId: id } : null;
  }

  private async view(id: string) {
    const s = await this.db.subscription.findUniqueOrThrow({ where: { id }, include: { plan: true } });
    return {
      id: s.id,
      plan: { code: s.plan.code, name: s.plan.name },
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    };
  }

  private audit(
    userId: string,
    action: string,
    resourceId: string | null,
    ctx: RequestContext,
    newValues: Record<string, string> = {},
  ) {
    return recordAudit(this.db, {
      userId,
      action,
      resourceType: 'subscription',
      resourceId,
      newValues,
      ...auditCtx(ctx),
    });
  }
}

const audienceOf = (account: Account): Audience => ('userId' in account ? 'user' : 'business');

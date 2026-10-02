import { AppError, ErrorCodes, logger } from '@buku/common';

/**
 * The few Paddle Billing API calls BUKU needs (D-069), over plain fetch — no
 * SDK, so no extra dependency to trust. Every call has a timeout; Paddle
 * errors become a 502 for the caller and a log line for us (never the raw
 * Paddle response, which can contain customer data).
 *
 * Sandbox: https://sandbox-api.paddle.com · Live: https://api.paddle.com
 */

export interface PaddleSubscription {
  id: string;
  status: 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing';
  customer_id: string;
  items: { price: { id: string }; quantity: number }[];
  current_billing_period: { starts_at: string; ends_at: string } | null;
  scheduled_change: { action: 'cancel' | 'pause' | 'resume'; effective_at: string } | null;
  custom_data: Record<string, unknown> | null;
  canceled_at: string | null;
  updated_at: string;
}

export interface PaddleSettings {
  apiUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class PaddleClient {
  private readonly log = logger.child({ module: 'paddle' });

  constructor(private readonly settings: PaddleSettings) {}

  /** A checkout for one price; `custom_data` ties the payment to a BUKU account. */
  async createTransaction(priceId: string, customData: Record<string, string>) {
    const { data } = await this.call<{ data: { id: string; checkout: { url: string | null } | null } }>(
      'POST',
      '/transactions',
      { items: [{ price_id: priceId, quantity: 1 }], custom_data: customData },
    );
    return { id: data.id, checkoutUrl: data.checkout?.url ?? null };
  }

  async getSubscription(id: string) {
    return (await this.call<{ data: PaddleSubscription }>('GET', `/subscriptions/${encodeURIComponent(id)}`))
      .data;
  }

  async cancelSubscription(id: string, effectiveFrom: 'next_billing_period' | 'immediately') {
    return (
      await this.call<{ data: PaddleSubscription }>(
        'POST',
        `/subscriptions/${encodeURIComponent(id)}/cancel`,
        {
          effective_from: effectiveFrom,
        },
      )
    ).data;
  }

  /** Undo a scheduled cancellation. */
  async removeScheduledChange(id: string) {
    return (
      await this.call<{ data: PaddleSubscription }>('PATCH', `/subscriptions/${encodeURIComponent(id)}`, {
        scheduled_change: null,
      })
    ).data;
  }

  /** Move to another price now; the difference is charged or credited for the rest of the period. */
  async changePrice(id: string, priceId: string) {
    return (
      await this.call<{ data: PaddleSubscription }>('PATCH', `/subscriptions/${encodeURIComponent(id)}`, {
        items: [{ price_id: priceId, quantity: 1 }],
        proration_billing_mode: 'prorated_immediately',
      })
    ).data;
  }

  /** Signed links into Paddle's customer portal (update card, invoices). Not cacheable. */
  async portalLinks(customerId: string, subscriptionId: string) {
    const { data } = await this.call<{
      data: {
        urls: {
          general: { overview: string };
          subscriptions: {
            id: string;
            update_subscription_payment_method: string;
            cancel_subscription: string;
          }[];
        };
      };
    }>('POST', `/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
      subscription_ids: [subscriptionId],
    });
    const sub = data.urls.subscriptions.find((s) => s.id === subscriptionId);
    return {
      overview: data.urls.general.overview,
      updatePaymentMethod: sub?.update_subscription_payment_method ?? null,
    };
  }

  async createProduct(input: { name: string; description: string | null; taxCategory: string }) {
    const { data } = await this.call<{ data: { id: string } }>('POST', '/products', {
      name: input.name,
      tax_category: input.taxCategory,
      ...(input.description && { description: input.description }),
    });
    return data.id;
  }

  async createPrice(input: {
    productId: string;
    description: string;
    amountCents: number;
    currency: string;
    interval: 'month' | 'year';
    trialDays: number;
    taxInclusive: boolean;
  }) {
    const { data } = await this.call<{ data: { id: string } }>('POST', '/prices', {
      product_id: input.productId,
      description: input.description,
      unit_price: { amount: String(input.amountCents), currency_code: input.currency },
      billing_cycle: { interval: input.interval, frequency: 1 },
      ...(input.trialDays > 0 && { trial_period: { interval: 'day', frequency: input.trialDays } }),
      // internal: tax is inside the price; external: tax is added on top.
      tax_mode: input.taxInclusive ? 'internal' : 'external',
    });
    return data.id;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.settings.apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? 10_000),
      });
    } catch (err) {
      this.log.error({ err, method, path }, 'Paddle unreachable');
      throw unavailable(err);
    }
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      this.log.error(
        { status: res.status, code: detail?.error?.code, method, path },
        'Paddle refused a request',
      );
      throw unavailable();
    }
    return (await res.json()) as T;
  }
}

const unavailable = (cause?: unknown) =>
  new AppError(
    'The payment provider is unavailable right now; please try again shortly',
    ErrorCodes.SERVICE_UNAVAILABLE,
    502,
    {
      ...(cause !== undefined && { cause }),
    },
  );

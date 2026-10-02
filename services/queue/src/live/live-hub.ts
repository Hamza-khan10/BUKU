import { AppError, logger } from '@buku/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';

/**
 * Live queue screens over Server-Sent Events (D-063).
 *
 * One public stream per business carries what the shop's display and the
 * customers' phones need — ticket numbers only, never names — so nobody signs
 * in to watch and no personal stream exists. Every change anywhere is
 * announced on one Valkey channel; each replica of queue-service hears it,
 * re-reads the queue (at most once per `debounceMs`, and only for businesses
 * someone here is watching) and pushes the fresh state to its viewers. Reading
 * the database rather than trusting the message means a late or duplicated
 * announcement can never show an old state.
 *
 *  • heartbeat comments keep proxies from closing quiet streams;
 *  • `retry:` tells browsers how soon to reconnect, and each reconnect starts
 *    with the full current state, so nothing is lost while disconnected;
 *  • limits per replica and per client address protect the server;
 *  • `close()` ends every stream at shutdown so deploys don't wait on them.
 *
 * Live updates are best effort: if Valkey is briefly unreachable, viewers keep
 * their last state and catch up on the next change or reconnect.
 */

export const CHANGES_CHANNEL = 'queue:changes';

export interface LiveHubOptions {
  /** Separate connection: a subscribed Valkey client can't run other commands. */
  subscriber: Redis;
  publisher: Redis;
  /** Current public state of a business's queue (throws if the business is gone). */
  state: (businessId: string) => Promise<unknown>;
  maxConnections?: number;
  maxPerClient?: number;
  heartbeatMs?: number;
  debounceMs?: number;
  retryMs?: number;
}

interface Viewer {
  res: Response;
  client: string;
}

export class LiveHub {
  private readonly viewers = new Map<string, Set<Viewer>>();
  private readonly perClient = new Map<string, number>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private total = 0;
  private sequence = 0;
  private heartbeat: NodeJS.Timeout | undefined;
  private closed = false;
  private readonly log = logger.child({ module: 'queue-live' });

  constructor(private readonly options: LiveHubOptions) {}

  async start(): Promise<void> {
    this.options.subscriber.on('message', (channel, businessId) => {
      if (channel === CHANGES_CHANNEL) this.schedule(businessId);
    });
    await this.options.subscriber.subscribe(CHANGES_CHANNEL);
    this.heartbeat = setInterval(() => this.broadcastComment('ping'), this.options.heartbeatMs ?? 15_000);
    this.heartbeat.unref();
  }

  /** Announce a change to every replica (best effort). */
  notify(businessId: string): void {
    this.options.publisher.publish(CHANGES_CHANNEL, businessId).catch((err: unknown) => {
      this.log.warn({ err, businessId }, 'could not announce a queue change');
    });
  }

  get viewerCount(): number {
    return this.total;
  }

  /**
   * Turn `res` into a live stream of `businessId`'s queue. Throws (503/429)
   * when a limit is reached, before anything is sent.
   */
  async watch(businessId: string, res: Response, client: string): Promise<void> {
    const maxTotal = this.options.maxConnections ?? 5_000;
    // Generous: many phones share one address on mobile networks (carrier-grade NAT).
    const maxPerClient = this.options.maxPerClient ?? 50;
    if (this.closed || this.total >= maxTotal) {
      res.setHeader('Retry-After', '30');
      throw AppError.unavailable('Live updates are busy; please refresh in a moment');
    }
    if ((this.perClient.get(client) ?? 0) >= maxPerClient) {
      res.setHeader('Retry-After', '30');
      throw AppError.rateLimited(30);
    }

    const initial = await this.options.state(businessId); // 404s before the stream starts
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // proxies must pass events through at once
    res.flushHeaders();
    res.write(`retry: ${this.options.retryMs ?? 5_000}\n\n`);
    this.send(res, initial);

    const viewer: Viewer = { res, client };
    let set = this.viewers.get(businessId);
    if (!set) this.viewers.set(businessId, (set = new Set()));
    set.add(viewer);
    this.total++;
    this.perClient.set(client, (this.perClient.get(client) ?? 0) + 1);

    res.on('close', () => {
      if (!set.delete(viewer)) return;
      if (set.size === 0) this.viewers.delete(businessId);
      this.total--;
      const left = (this.perClient.get(client) ?? 1) - 1;
      if (left > 0) this.perClient.set(client, left);
      else this.perClient.delete(client);
    });
  }

  /** End every stream (shutdown). Browsers reconnect to another replica on their own. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const set of this.viewers.values()) for (const v of set) v.res.end();
    this.viewers.clear();
    await this.options.subscriber.unsubscribe(CHANGES_CHANNEL).catch(() => undefined);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Coalesce bursts (a busy front desk) into one read per business per `debounceMs`. */
  private schedule(businessId: string): void {
    if (!this.viewers.has(businessId) || this.pending.has(businessId)) return;
    const timer = setTimeout(() => {
      this.pending.delete(businessId);
      void this.refresh(businessId);
    }, this.options.debounceMs ?? 100);
    this.pending.set(businessId, timer);
  }

  private async refresh(businessId: string): Promise<void> {
    const set = this.viewers.get(businessId);
    if (!set?.size) return;
    try {
      const state = await this.options.state(businessId);
      for (const v of set) this.send(v.res, state);
    } catch (err) {
      // e.g. the business was suspended: tell viewers and stop.
      this.log.warn({ err, businessId }, 'live queue state unavailable; closing its streams');
      for (const v of set) {
        v.res.write('event: unavailable\ndata: {}\n\n');
        v.res.end();
      }
    }
  }

  private send(res: Response, state: unknown): void {
    res.write(`id: ${++this.sequence}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
  }

  private broadcastComment(text: string): void {
    for (const set of this.viewers.values()) for (const v of set) v.res.write(`: ${text}\n\n`);
  }
}

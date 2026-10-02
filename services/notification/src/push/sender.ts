import { randomUUID } from 'node:crypto';
import { logger } from '@buku/common';

/**
 * Sending push notifications. Two senders:
 *  • log  — development: writes what would be sent to the log (no device needed);
 *  • expo — Expo's push service (iPhone and Android from the Expo app; free).
 * Each send returns a ticket per message; receipts (≈15 min later) say whether
 * it reached the device and whether the device still exists.
 */

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string | number>;
}

export type PushTicket = { ok: true; id: string } | { ok: false; error: string; deviceGone: boolean };
export type PushReceipt = { ok: true } | { ok: false; error: string; deviceGone: boolean };

export interface PushSender {
  readonly name: string;
  /** Whether this sender can deliver to a token of this format. */
  accepts(token: string): boolean;
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  receipts(ticketIds: string[]): Promise<Map<string, PushReceipt>>;
}

export class LogPushSender implements PushSender {
  readonly name = 'log';
  private readonly log = logger.child({ module: 'push-log' });

  accepts(): boolean {
    return true;
  }

  send(messages: PushMessage[]): Promise<PushTicket[]> {
    // Titles only: bodies can contain names and codes.
    for (const m of messages) this.log.info({ title: m.title, screen: m.data.screen }, 'push (log sender)');
    return Promise.resolve(messages.map(() => ({ ok: true as const, id: `log-${randomUUID()}` })));
  }

  receipts(ticketIds: string[]): Promise<Map<string, PushReceipt>> {
    return Promise.resolve(new Map(ticketIds.map((id) => [id, { ok: true as const }])));
  }
}

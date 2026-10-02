import { logger } from '@buku/common';
import type { PushMessage, PushReceipt, PushSender, PushTicket } from './sender.js';

/**
 * Expo's push service (https://exp.host/--/api/v2/push). Up to 100 messages
 * per send, up to 1000 receipt ids per query. `DeviceNotRegistered` means the
 * app was uninstalled or the token expired: that device is switched off.
 * An access token is optional (required once "push security" is enabled in
 * the Expo project — recommended in production).
 */

const SEND_BATCH = 100;
const RECEIPT_BATCH = 1000;
const TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

type ExpoTicket =
  { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };
type ExpoReceipt = { status: 'ok' } | { status: 'error'; message: string; details?: { error?: string } };

export class ExpoPushSender implements PushSender {
  readonly name = 'expo';
  private readonly log = logger.child({ module: 'push-expo' });

  constructor(
    private readonly settings: {
      baseUrl?: string;
      accessToken?: string | undefined;
      timeoutMs?: number;
    } = {},
  ) {}

  accepts(token: string): boolean {
    return TOKEN.test(token);
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += SEND_BATCH) {
      const batch = messages.slice(i, i + SEND_BATCH);
      try {
        const { data } = await this.post<{ data: ExpoTicket[] }>(
          '/send',
          batch.map((m) => ({
            to: m.token,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            priority: 'high',
          })),
        );
        tickets.push(...batch.map((_, j) => toResult(data[j])));
      } catch (err) {
        this.log.error({ err, count: batch.length }, 'Expo push send failed');
        tickets.push(...batch.map(() => ({ ok: false as const, error: 'send_failed', deviceGone: false })));
      }
    }
    return tickets;
  }

  async receipts(ticketIds: string[]): Promise<Map<string, PushReceipt>> {
    const result = new Map<string, PushReceipt>();
    for (let i = 0; i < ticketIds.length; i += RECEIPT_BATCH) {
      const { data } = await this.post<{ data: Record<string, ExpoReceipt> }>('/getReceipts', {
        ids: ticketIds.slice(i, i + RECEIPT_BATCH),
      });
      for (const [id, r] of Object.entries(data)) {
        result.set(id, r.status === 'ok' ? { ok: true } : failure(r.details?.error ?? r.message));
      }
    }
    return result;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.settings.baseUrl ?? 'https://exp.host/--/api/v2/push'}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        ...(this.settings.accessToken && { Authorization: `Bearer ${this.settings.accessToken}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.settings.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`Expo push service answered ${res.status}`);
    return (await res.json()) as T;
  }
}

function toResult(t: ExpoTicket | undefined): PushTicket {
  if (!t) return { ok: false, error: 'no_ticket', deviceGone: false };
  return t.status === 'ok' ? { ok: true, id: t.id } : failure(t.details?.error ?? t.message);
}

const failure = (error: string) => ({
  ok: false as const,
  error,
  deviceGone: error === 'DeviceNotRegistered',
});

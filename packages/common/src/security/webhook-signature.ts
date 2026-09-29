import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Outgoing webhook signatures (BUKU → business servers).
 *
 * Header:  X-Buku-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 * Signed:  "<t>.<raw request body>"
 *
 * Signing the timestamp together with the body means an attacker who captures
 * one delivery cannot replay it later: receivers reject signatures older than
 * the tolerance window. (A bare `sha256=<hmac(body)>` has no such protection.)
 * `v1` versions the scheme so it can evolve without breaking receivers.
 */

export const WEBHOOK_SIGNATURE_HEADER = 'X-Buku-Signature';
const DEFAULT_TOLERANCE_SECONDS = 300;

function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function signWebhookPayload(
  secret: string,
  rawBody: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`;
}

export type WebhookVerification =
  { valid: true } | { valid: false; reason: 'malformed' | 'expired' | 'mismatch' };

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  header: string | undefined,
  options: { toleranceSeconds?: number; now?: number } = {},
): WebhookVerification {
  if (!header) return { valid: false, reason: 'malformed' };
  const parts = new Map(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return { valid: false, reason: 'malformed' };

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) {
    return { valid: false, reason: 'expired' };
  }

  const expected = Buffer.from(computeSignature(secret, t, rawBody), 'hex');
  const received = Buffer.from(v1, 'hex');
  return timingSafeEqual(expected, received) ? { valid: true } : { valid: false, reason: 'mismatch' };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paddle webhook signatures: `Paddle-Signature: ts=<unix seconds>;h1=<hex>`
 * where h1 = HMAC-SHA256(endpoint secret, `${ts}:${raw body}`). During a
 * secret rotation several h1 values may be present; any match is accepted.
 *
 * Refused: a missing or malformed header, a timestamp outside the tolerance
 * (replays of old deliveries), or no matching signature. Compared in
 * constant time. Duplicate deliveries inside the tolerance are stopped by
 * idempotency (each event id is processed once).
 */
export function verifyPaddleSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  toleranceSeconds: number,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' } {
  if (!header) return { ok: false, reason: 'missing' };
  let ts: string | undefined;
  const h1: string[] = [];
  for (const part of header.split(';')) {
    const [key, value] = part.split('=', 2).map((x) => x.trim());
    if (key === 'ts') ts = value;
    else if (key === 'h1' && value) h1.push(value);
  }
  if (!ts || !/^\d{1,12}$/.test(ts) || h1.length === 0) return { ok: false, reason: 'malformed' };
  if (Math.abs(now / 1000 - Number(ts)) > toleranceSeconds) return { ok: false, reason: 'expired' };

  const expected = createHmac('sha256', secret).update(`${ts}:`).update(rawBody).digest();
  const matches = h1.some((sig) => {
    if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
    return timingSafeEqual(Buffer.from(sig, 'hex'), expected);
  });
  return matches ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** Sign a body like Paddle does (tests and local tools). */
export function signPaddleBody(
  rawBody: string | Buffer,
  secret: string,
  ts: number = Math.floor(Date.now() / 1000),
): string {
  const h1 = createHmac('sha256', secret).update(`${ts}:`).update(rawBody).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

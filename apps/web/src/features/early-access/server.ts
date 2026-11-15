import 'server-only';
import { createHmac } from 'node:crypto';
import type { EarlyAccessInput } from './schema';

/**
 * Early access on the server (D-134). Signups are kept in Cloudflare D1 (D-135), which only this
 * website's own Worker can reach (its DB binding: no key travels anywhere), in one table whose
 * own checks repeat the website's (migrations/0001_waitlist.sql). A bot check (Cloudflare
 * Turnstile) comes first. The visitor's address is never stored, only a keyed hash of it, to
 * slow down repeats from one place.
 */

export interface EarlyAccessSettings {
  turnstileSiteKey: string;
  turnstileSecret: string;
  hashSecret: string;
}

/**
 * The settings, or 'test' for the in-memory store (development and the browser tests only:
 * switched on by EARLY_ACCESS_TEST_STORE, refused on the live site), or null: not available.
 * (On Workers, OpenNext puts the Worker's variables and secrets in process.env.)
 */
export function earlyAccessSettings(): EarlyAccessSettings | 'test' | null {
  const e = process.env;
  const settings = {
    turnstileSiteKey: e.TURNSTILE_SITE_KEY?.trim() ?? '',
    turnstileSecret: e.TURNSTILE_SECRET_KEY?.trim() ?? '',
    hashSecret: e.EARLY_ACCESS_HASH_SECRET?.trim() ?? '',
  };
  if (Object.values(settings).every(Boolean) && settings.hashSecret.length >= 32) return settings;
  if (e.EARLY_ACCESS_TEST_STORE === 'true' && !liveSite()) return 'test';
  return null;
}

/** The live site: Vercel's production, or the Worker on Cloudflare (wrangler.jsonc says so). */
const liveSite = () => process.env.VERCEL_ENV === 'production' || process.env.BUKU_SITE_ENV === 'production';

/** A keyed hash of the visitor's address: repeats can be counted, the address can't be read back. */
export function hashAddress(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/** Cloudflare's answer to "was this a person?": the token is used once, for this form only. */
export async function passedBotCheck(
  secret: string,
  token: string | undefined,
  ip: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const answer = (await res.json()) as { success?: unknown; action?: unknown };
    return answer.success === true && (answer.action === undefined || answer.action === 'early_access');
  } catch {
    return false;
  }
}

export type Outcome = 'joined' | 'already' | 'slow_down';

/** The part of D1's API used here (a Worker's D1Database has it; the tests give SQLite's). */
export interface Db {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

declare global {
  interface CloudflareEnv {
    /** The early-access list (wrangler.jsonc). */
    DB?: Db;
  }
}

/** The Worker's D1 database, or null where the site isn't running on Workers (Vercel, `next start`). */
export async function waitlistDb(): Promise<Db | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    return env.DB ?? null;
  } catch {
    return null;
  }
}

/** Five signups an hour from one address: enough for a family or an office, not a script. */
const PER_ADDRESS_PER_HOUR = 5;

/**
 * Keep a signup: one row per email and kind (a second time changes nothing), and from one address
 * at most five an hour. Dates are kept as ISO text, which sorts as time does.
 */
export async function saveSignup(
  db: Db,
  input: EarlyAccessInput,
  ipHash: string | null,
  now = new Date(),
): Promise<Outcome> {
  if (ipHash) {
    const since = new Date(now.getTime() - 3_600_000).toISOString();
    const recent = await db
      .prepare('SELECT count(*) AS n FROM waitlist WHERE ip_hash = ?1 AND created_at > ?2')
      .bind(ipHash, since)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= PER_ADDRESS_PER_HOUR) return 'slow_down';
  }
  const business = input.kind === 'business' ? input : null;
  const result = await db
    .prepare(
      `INSERT INTO waitlist (email, kind, name, business_name, business_type, branches, city, country, whatsapp,
         plan_interest, source, utm_source, utm_medium, utm_campaign, ip_hash, consent_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
       ON CONFLICT (email, kind) DO NOTHING`,
    )
    .bind(
      input.email,
      input.kind,
      input.name ?? null,
      business?.businessName ?? null,
      business?.businessType ?? null,
      business?.branches ?? null,
      input.city,
      input.country,
      business?.whatsapp ?? null,
      business?.planInterest ?? null,
      input.source ?? null,
      input.utmSource ?? null,
      input.utmMedium ?? null,
      input.utmCampaign ?? null,
      ipHash,
      now.toISOString(),
    )
    .run();
  return result.meta.changes > 0 ? 'joined' : 'already';
}

/** The browser tests' store: the same rules, kept in memory. */
const testRows = new Map<string, number>();
const testAddresses = new Map<string, number[]>();

export function saveToTestStore(input: EarlyAccessInput, ipHash: string | null, now = Date.now()): Outcome {
  if (ipHash) {
    const recent = (testAddresses.get(ipHash) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= PER_ADDRESS_PER_HOUR) return 'slow_down';
    testAddresses.set(ipHash, [...recent, now]);
  }
  const key = `${input.kind}:${input.email}`;
  if (testRows.has(key)) return 'already';
  testRows.set(key, now);
  return 'joined';
}

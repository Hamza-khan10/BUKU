import 'server-only';
import { createHmac } from 'node:crypto';
import type { EarlyAccessInput } from './schema';

/**
 * Early access on the server (D-134). Signups are kept in Supabase (Postgres), reached only from
 * this web server with a secret key, and only through one database function (join_waitlist) that
 * checks, de-duplicates and slows down repeats; the table itself is closed to everyone
 * (infrastructure/supabase/waitlist.sql). A bot check (Cloudflare Turnstile) comes first. The
 * visitor's address is never stored, only a keyed hash of it, to count repeats.
 */

export interface EarlyAccessSettings {
  supabaseUrl: string;
  supabaseKey: string;
  turnstileSiteKey: string;
  turnstileSecret: string;
  hashSecret: string;
}

/**
 * The settings, or 'test' for the in-memory store (development and the browser tests only:
 * switched on by EARLY_ACCESS_TEST_STORE, refused on the live site), or null: not available.
 */
export function earlyAccessSettings(): EarlyAccessSettings | 'test' | null {
  const e = process.env;
  const settings = {
    supabaseUrl: e.SUPABASE_URL?.trim() ?? '',
    supabaseKey: e.SUPABASE_SECRET_KEY?.trim() ?? '',
    turnstileSiteKey: e.TURNSTILE_SITE_KEY?.trim() ?? '',
    turnstileSecret: e.TURNSTILE_SECRET_KEY?.trim() ?? '',
    hashSecret: e.EARLY_ACCESS_HASH_SECRET?.trim() ?? '',
  };
  if (
    Object.values(settings).every(Boolean) &&
    isHttps(settings.supabaseUrl) &&
    settings.hashSecret.length >= 32
  )
    return settings;
  if (e.EARLY_ACCESS_TEST_STORE === 'true' && e.VERCEL_ENV !== 'production') return 'test';
  return null;
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

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

/** The database function's parameters, by name (PostgREST passes a JSON object to a function). */
export function rowOf(input: EarlyAccessInput, ipHash: string | null) {
  const business = input.kind === 'business' ? input : null;
  return {
    p_email: input.email,
    p_kind: input.kind,
    p_name: input.name ?? null,
    p_business_name: business?.businessName ?? null,
    p_business_type: business?.businessType ?? null,
    p_branches: business?.branches ?? null,
    p_city: input.city,
    p_country: input.country,
    p_whatsapp: business?.whatsapp ?? null,
    p_plan_interest: business?.planInterest ?? null,
    p_source: input.source ?? null,
    p_utm_source: input.utmSource ?? null,
    p_utm_medium: input.utmMedium ?? null,
    p_utm_campaign: input.utmCampaign ?? null,
    p_ip_hash: ipHash,
  };
}

/** Keep a signup in Supabase, through join_waitlist only. Throws when Supabase can't be reached. */
export async function saveSignup(
  settings: EarlyAccessSettings,
  input: EarlyAccessInput,
  ipHash: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Outcome> {
  const key = settings.supabaseKey;
  const res = await fetchImpl(`${settings.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/join_waitlist`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: key,
      // The older keys are tokens (JWTs) and go in Authorization too; the newer secret keys don't.
      ...(key.startsWith('eyJ') && { authorization: `Bearer ${key}` }),
    },
    body: JSON.stringify(rowOf(input, ipHash)),
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`join_waitlist answered ${res.status}`);
  const outcome = (await res.json()) as unknown;
  if (outcome === 'joined' || outcome === 'already' || outcome === 'slow_down') return outcome;
  throw new Error('join_waitlist answered something unexpected');
}

/** The browser tests' store: the same rules as join_waitlist, kept in memory. */
const testRows = new Map<string, number>();
const testAddresses = new Map<string, number[]>();

export function saveToTestStore(input: EarlyAccessInput, ipHash: string | null, now = Date.now()): Outcome {
  if (ipHash) {
    const recent = (testAddresses.get(ipHash) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= 5) return 'slow_down';
    testAddresses.set(ipHash, [...recent, now]);
  }
  const key = `${input.kind}:${input.email}`;
  if (testRows.has(key)) return 'already';
  testRows.set(key, now);
  return 'joined';
}

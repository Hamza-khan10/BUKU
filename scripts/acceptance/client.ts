/**
 * A small HTTP client for acceptance runs through the gateway, as the apps
 * would call it. It paces itself under the gateway's per-address limits
 * (500/minute overall, 20/minute for sign-in) and waits politely when told
 * to slow down, so a run never fails because of its own speed.
 */
import { execFileSync } from 'node:child_process';

export const API = process.env.ACCEPTANCE_API ?? 'http://localhost:8000';

export interface Res {
  status: number;
  body: {
    success?: boolean;
    data?: unknown;
    meta?: unknown;
    error?: { code: string; message: string };
  } & Record<string, unknown>;
}

const MIN_GAP_MS = 140; // ≈ 7 requests a second
let next = 0;
async function pace() {
  const now = Date.now();
  const wait = Math.max(0, next - now);
  next = Math.max(now, next) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export async function call(
  method: string,
  path: string,
  opts: { token?: string | undefined; body?: unknown; paced?: boolean; timeoutMs?: number } = {},
): Promise<Res> {
  for (let attempt = 0; ; attempt++) {
    if (opts.paced !== false) await pace();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(opts.token && { Authorization: `Bearer ${opts.token}` }),
        ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    // Gateway rate limit (not a service answer): wait and try again.
    if (res.status === 429 && res.headers.get('x-ratelimit-limit-minute') && attempt < 8) {
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, 8_000));
      continue;
    }
    const text = await res.text();
    let body: Res['body'];
    try {
      body = JSON.parse(text) as Res['body'];
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body };
  }
}

export const data = <T = Record<string, unknown>>(r: Res) => r.body.data as T;

export interface Person {
  id: string;
  token: string;
  email: string;
}

/** Development sign-in (refused in production by configuration). */
export async function signIn(
  email: string,
  role: 'user' | 'business_owner' | 'super_admin' = 'user',
  name?: string,
): Promise<Person> {
  const r = await call('POST', '/v1/auth/dev/login', { body: { email, role, ...(name && { name }) } });
  if (r.status >= 300) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  const d = data<{ accessToken: string; user: { id: string } }>(r);
  return { id: d.user.id, token: d.accessToken, email };
}

/**
 * Simulated time: acceptance can't wait a day for a reminder, so a few steps
 * move an appointment in the development database (as the app role, never
 * as an admin). Everything else goes through the public API.
 */
export function sql(statement: string): string {
  const password = process.env.BUKU_APP_PASSWORD;
  if (!password) throw new Error('BUKU_APP_PASSWORD missing (run from the repo root with .env)');
  return execFileSync(
    'docker',
    [
      'exec',
      '-e',
      `PGPASSWORD=${password}`,
      'buku-postgres-1',
      'psql',
      '-h',
      'localhost',
      '-U',
      'buku_app',
      '-d',
      'buku',
      '-Atq',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}

/** Poll until `check` returns something truthy, or fail after `ms`. */
export async function eventually<T>(
  what: string,
  check: () => Promise<T | null | undefined | false>,
  ms = 20_000,
) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

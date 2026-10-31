import 'server-only';
import { createHash } from 'node:crypto';
import { REQUEST_ID_HEADER, requestIdFrom } from '@buku/web-security/request-id';
import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { callApi } from './gateway';
import { readTokens } from './session';

export interface Me {
  id: string;
  name: string;
  email: string | null;
  role: 'user' | 'business_owner' | 'super_admin';
}

/** Where a page request stands. */
export type Gate =
  | { kind: 'signed-out' }
  | { kind: 'renew' }
  | { kind: 'not-admin' }
  | { kind: 'needs-two-step'; me: Me }
  | { kind: 'unavailable'; message: string; reference: string | null }
  | { kind: 'ok'; me: Me; accessToken: string; requestId: string; incoming: Headers };

/**
 * Who is asking, checked with the API on every page: a valid session, a
 * platform admin, with two-step sign-in set up. The API checks all of this
 * again on every admin call (role, and a session that passed two-step); this
 * only decides what the page shows. Asked once per request (the console's layout and its page
 * share the answer).
 */
/**
 * A fully passed check (a platform admin, two-step sign-in on), remembered for a minute per
 * session: every page asks, and the API's sign-in routes allow only 20 calls a minute from one
 * place, so browsing the console quickly would otherwise run out. The API still checks role and
 * two-step on every admin call; this only decides what a page draws. Nothing else is remembered —
 * someone setting up two-step, or no longer an admin, is asked again at once.
 */
const PASSED_FOR_MS = 60_000;
const passed = new Map<string, { until: number; me: Me }>();
const sessionKey = (accessToken: string) => createHash('sha256').update(accessToken).digest('hex');
function remember(accessToken: string, me: Me) {
  if (passed.size >= 500) passed.delete(passed.keys().next().value!);
  passed.set(sessionKey(accessToken), { until: Date.now() + PASSED_FOR_MS, me });
}

export const adminGate = cache(async function adminGate(): Promise<Gate> {
  const jar = await cookies();
  const incoming = await headers();
  const requestId = requestIdFrom(incoming.get(REQUEST_ID_HEADER));
  const { accessToken, signedIn } = readTokens(jar);
  const lapsed = (): Gate => (signedIn ? { kind: 'renew' } : { kind: 'signed-out' });
  if (!accessToken) return lapsed();
  const known = passed.get(sessionKey(accessToken));
  if (known && known.until > Date.now())
    return { kind: 'ok', me: known.me, accessToken, requestId, incoming };

  const me = await callApi<Me>({ path: '/v1/auth/me', accessToken, incoming, requestId });
  if (!me.ok) {
    if (me.status === 401) return lapsed();
    return { kind: 'unavailable', message: me.error.message, reference: me.requestId };
  }
  if (me.data.role !== 'super_admin') return { kind: 'not-admin' };

  const mfa = await callApi<{ enabled: boolean }>({ path: '/v1/auth/mfa', accessToken, incoming, requestId });
  if (!mfa.ok) return { kind: 'unavailable', message: mfa.error.message, reference: mfa.requestId };
  if (!mfa.data.enabled) return { kind: 'needs-two-step', me: me.data };
  remember(accessToken, me.data);
  return { kind: 'ok', me: me.data, accessToken, requestId, incoming };
});

/** For pages that need a fully signed-in admin: anything else goes where it should. */
export async function requireAdmin(path: string): Promise<Extract<Gate, { kind: 'ok' | 'unavailable' }>> {
  const gate = await adminGate();
  if (gate.kind === 'signed-out') redirect('/signin');
  if (gate.kind === 'renew') redirect(`/api/session/renew?next=${encodeURIComponent(path)}` as Route);
  // An account that isn't (or is no longer) a platform admin: its session ends here.
  if (gate.kind === 'not-admin') redirect('/api/session/end?reason=not-admin');
  if (gate.kind === 'needs-two-step') redirect('/two-step');
  return gate;
}

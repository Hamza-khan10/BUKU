import 'server-only';
import { REQUEST_ID_HEADER, requestIdFrom } from '@buku/web-security/request-id';
import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
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
 * only decides what the page shows.
 */
export async function adminGate(): Promise<Gate> {
  const jar = await cookies();
  const incoming = await headers();
  const requestId = requestIdFrom(incoming.get(REQUEST_ID_HEADER));
  const { accessToken, signedIn } = readTokens(jar);
  const lapsed = (): Gate => (signedIn ? { kind: 'renew' } : { kind: 'signed-out' });
  if (!accessToken) return lapsed();

  const me = await callApi<Me>({ path: '/v1/auth/me', accessToken, incoming, requestId });
  if (!me.ok) {
    if (me.status === 401) return lapsed();
    return { kind: 'unavailable', message: me.error.message, reference: me.requestId };
  }
  if (me.data.role !== 'super_admin') return { kind: 'not-admin' };

  const mfa = await callApi<{ enabled: boolean }>({ path: '/v1/auth/mfa', accessToken, incoming, requestId });
  if (!mfa.ok) return { kind: 'unavailable', message: mfa.error.message, reference: mfa.requestId };
  if (!mfa.data.enabled) return { kind: 'needs-two-step', me: me.data };
  return { kind: 'ok', me: me.data, accessToken, requestId, incoming };
}

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

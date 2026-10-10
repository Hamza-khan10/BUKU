import 'server-only';
import { takeChallenge, takeSession } from '@buku/web-security/session-policy';
import type { NextResponse } from 'next/server';
import type { Me } from './admin';
import { callApi } from './gateway';
import { errorJson, json } from './respond';
import { setChallenge, setSession } from './session';

/** Where a sign-in step leaves this browser: somewhere to go (and cookies to set), or a refusal. */
export type Settled =
  | { next: '/' | '/signin/verify'; apply: (response: NextResponse) => void }
  | { refusal: { status: number; code: 'NOT_ADMIN' | 'BAD_ANSWER'; message: string } };

/**
 * Finishing a sign-in step (Google, development sign-in, or the two-step code):
 * the API's answer becomes cookies, never reaching the page. Only platform
 * admins get a session here: anyone else's is ended at the API at once. A
 * sign-in that needs its two-step code keeps the challenge in an HttpOnly
 * cookie and goes to the code page.
 */
export async function settleSignIn(
  answer: unknown,
  ctx: { incoming: Headers; requestId: string },
): Promise<Settled> {
  const asked = takeChallenge(answer);
  if (asked.challenge) {
    const challenge = asked.challenge;
    return { next: '/signin/verify', apply: (r) => setChallenge(r, challenge) };
  }
  const { tokens } = takeSession(answer);
  if (!tokens) {
    return {
      refusal: {
        status: 502,
        code: 'BAD_ANSWER',
        message: 'The sign-in answer was incomplete. Please try again.',
      },
    };
  }
  const me = await callApi<Me>({ path: '/v1/auth/me', accessToken: tokens.accessToken, ...ctx });
  if (!me.ok || me.data.role !== 'super_admin') {
    await callApi({
      method: 'POST',
      path: '/v1/auth/logout',
      body: { refreshToken: tokens.refreshToken },
      ...ctx,
    });
    return {
      refusal: {
        status: 403,
        code: 'NOT_ADMIN',
        message: 'This account isn’t a BUKU platform admin. Use the BUKU website instead.',
      },
    };
  }
  return { next: '/', apply: (r) => setSession(r, tokens) };
}

/** The same, as an answer to this app's own pages (JSON). */
export async function finishSignIn(
  answer: unknown,
  ctx: { incoming: Headers; requestId: string },
): Promise<NextResponse> {
  const settled = await settleSignIn(answer, ctx);
  if ('refusal' in settled) {
    return errorJson(ctx.requestId, settled.refusal.status, settled.refusal.code, settled.refusal.message);
  }
  const response = json(ctx.requestId, { next: settled.next });
  settled.apply(response);
  return response;
}

import 'server-only';
import { takeChallenge, takeSession } from '@buku/web-security/session-policy';
import type { NextResponse } from 'next/server';
import type { Me } from './admin';
import { callApi } from './gateway';
import { errorJson, json } from './respond';
import { setChallenge, setSession } from './session';

/**
 * Finishing a sign-in step (development sign-in, or the two-step code): the
 * API's answer becomes cookies, never reaching the page. Only platform admins
 * get a session here: anyone else's is ended at the API at once, and they're
 * told this isn't their app. A sign-in that needs its two-step code first
 * keeps the challenge in an HttpOnly cookie and goes to the code page.
 */
export async function finishSignIn(
  answer: unknown,
  ctx: { incoming: Headers; requestId: string },
): Promise<NextResponse> {
  const asked = takeChallenge(answer);
  if (asked.challenge) {
    const response = json(ctx.requestId, { next: '/signin/verify' });
    setChallenge(response, asked.challenge);
    return response;
  }
  const { tokens } = takeSession(answer);
  if (!tokens)
    return errorJson(
      ctx.requestId,
      502,
      'BAD_ANSWER',
      'The sign-in answer was incomplete. Please try again.',
    );

  const me = await callApi<Me>({ path: '/v1/auth/me', accessToken: tokens.accessToken, ...ctx });
  if (!me.ok || me.data.role !== 'super_admin') {
    await callApi({
      method: 'POST',
      path: '/v1/auth/logout',
      body: { refreshToken: tokens.refreshToken },
      ...ctx,
    });
    return errorJson(
      ctx.requestId,
      403,
      'NOT_ADMIN',
      'This account isn’t a BUKU platform admin. Use the BUKU website instead.',
    );
  }
  const response = json(ctx.requestId, { next: '/' });
  setSession(response, tokens);
  return response;
}

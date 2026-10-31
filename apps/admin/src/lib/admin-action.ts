import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { currentAccess } from './access';
import { ownPageCall, smallJson } from './endpoint';
import { callApi } from './gateway';
import { errorJson, json } from './respond';
import { setSession } from './session';

/** The API's ID formats (DB-042): a business or person by its public ID, a row by its decimal ID. */
export const PUBLIC_ID = /^[0-9A-Za-z]{12}$/;
export const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;

/** What a route makes of the page's request: the API call, or why not. */
export type Plan =
  | { path: string; method?: 'POST' | 'PUT'; body?: unknown }
  | { refuse: { status: number; code: string; message: string } };

/**
 * One operator action from the console's own pages, passed to the admin API. First, that it came
 * from this app's pages (our header, our origin); then the route's own check of what was sent;
 * then the call, with the session's token. The API checks again that it's a platform admin who
 * has passed two-step sign-in, records the action, and answers; its answer — or its refusal,
 * word for word — comes back to the page.
 */
export async function adminAction(
  request: NextRequest,
  plan: (body: Record<string, unknown> | null) => Plan,
): Promise<NextResponse> {
  const start = ownPageCall(request);
  if ('refusal' in start) return start.refusal;
  const { requestId } = start;
  const call = plan(await smallJson(request));
  if ('refuse' in call)
    return errorJson(requestId, call.refuse.status, call.refuse.code, call.refuse.message);
  const access = await currentAccess(request, requestId);
  if (!access) return errorJson(requestId, 401, 'NOT_SIGNED_IN', 'Please sign in again.');
  const answer = await callApi({
    method: call.method ?? 'POST',
    path: call.path,
    body: call.body,
    accessToken: access.accessToken,
    incoming: request.headers,
    requestId,
  });
  const response = answer.ok
    ? json(requestId, answer.data ?? null)
    : errorJson(requestId, answer.status, answer.error.code, answer.error.message, answer.error.details);
  if (access.renewed) setSession(response, access.renewed);
  return response;
}

/** A refusal for a route's plan. */
export const refuse = (status: number, code: string, message: string): Plan => ({
  refuse: { status, code, message },
});

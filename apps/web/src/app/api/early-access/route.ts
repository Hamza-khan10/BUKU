import { NextResponse, type NextRequest } from 'next/server';
import { EarlyAccessInput, EarlyAccessRequest, fieldProblems } from '@/features/early-access/schema';
import {
  earlyAccessSettings,
  hashAddress,
  passedBotCheck,
  saveSignup,
  saveToTestStore,
  waitlistDb,
} from '@/features/early-access/server';
import { checkSameOrigin } from '@/lib/api/bff-rules';
import { errorResponse } from '@/lib/api/respond';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';
import { clientIpFrom } from '@/lib/http/client-ip';

/** A signup is a few short fields: anything bigger isn't one. */
const MAX_BYTES = 8 * 1024;

/**
 * Joining the early-access list (D-134). Only this site's own page may send it (our header, and
 * the browser's word that it came from here); the details are checked against BUKU's text rules;
 * a bot check comes before anything is kept. Whether an email was already on the list is never
 * said, so nobody can use the form to find out who signed up.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const notOurs = checkSameOrigin('POST', request.headers, request.nextUrl.origin);
  if (notOurs) return errorResponse(requestId, notOurs.status, notOurs.code, notOurs.message);

  const settings = earlyAccessSettings();
  if (!settings)
    return errorResponse(
      requestId,
      503,
      'NOT_AVAILABLE',
      'Early access isn’t open yet. Please try again soon.',
    );

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    return errorResponse(requestId, 413, 'TOO_LARGE', 'That’s more than a signup.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse(requestId, 400, 'BAD_REQUEST', 'Please try again.');
  }
  const envelope = EarlyAccessRequest.safeParse(body);
  if (!envelope.success) return errorResponse(requestId, 400, 'BAD_REQUEST', 'Please try again.');
  const details = EarlyAccessInput.safeParse(envelope.data.details);
  if (!details.success)
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          fields: fieldProblems(details.error),
          requestId,
        },
      },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } },
    );

  // The visitor's address, as the host tells it (Vercel's own header there); never stored as is.
  const ip = clientIpFrom(
    request.headers,
    process.env.WEB_CLIENT_IP_HEADER || (process.env.VERCEL ? 'x-real-ip' : undefined),
  );

  let outcome;
  if (settings === 'test') {
    outcome = saveToTestStore(details.data, ip ? hashAddress(ip, 'test') : null);
  } else {
    if (!(await passedBotCheck(settings.turnstileSecret, envelope.data.turnstileToken, ip)))
      return errorResponse(
        requestId,
        403,
        'BOT_CHECK_FAILED',
        'Please complete the check below and try again.',
      );
    const db = await waitlistDb();
    if (!db)
      return errorResponse(
        requestId,
        503,
        'NOT_AVAILABLE',
        'Early access isn’t open yet. Please try again soon.',
      );
    try {
      outcome = await saveSignup(db, details.data, ip ? hashAddress(ip, settings.hashSecret) : null);
    } catch (err) {
      // eslint-disable-next-line no-console -- the Worker's own log (Cloudflare keeps it): what failed and the request, never the person's details.
      console.error(
        JSON.stringify({ msg: 'early access: not saved', requestId, error: (err as Error).message }),
      );
      return errorResponse(
        requestId,
        503,
        'NOT_SAVED',
        'We couldn’t save that just now. Please try again in a minute.',
      );
    }
  }

  if (outcome === 'slow_down')
    return errorResponse(
      requestId,
      429,
      'RATE_LIMITED',
      'A few signups have come from here already. Please try again later.',
    );
  // Joined or already there: the same answer either way.
  return NextResponse.json(
    { success: true, data: { onTheList: true } },
    { status: 200, headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } },
  );
}

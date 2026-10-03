/**
 * Errors from the API, in one shape for every screen (WEB_PLAN §4). The API's
 * envelope is `{ success: false, error: { code, message, details, requestId } }`;
 * the gateway's own refusals are `{ message }`; a network failure has neither.
 * Screens branch on `code`, show `message`, and print `requestId` so support
 * can find the request in the logs.
 */

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string | undefined,
    /** Validation issues (an array of { path, message }) or other structured detail. */
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Validation problems by field ("name" → "Emojis and picture symbols can’t be used here."). */
  get fieldIssues(): FieldIssue[] {
    const issues = this.details;
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((i: unknown) => {
      if (typeof i !== 'object' || i === null) return [];
      const { path, message } = i as { path?: unknown; message?: unknown };
      if (typeof message !== 'string') return [];
      const p = Array.isArray(path) ? path.join('.') : typeof path === 'string' ? path : '';
      return [{ path: p, message }];
    });
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

/** What we tell people when we couldn't reach BUKU at all. */
export const NETWORK_MESSAGE = 'We couldn’t reach BUKU. Check your connection and try again.';

/** Turn a non-OK response's body into an ApiError, whatever produced it. */
export function apiErrorFrom(status: number, body: unknown, requestId?: string | null): ApiError {
  const rid = requestId ?? undefined;
  if (typeof body === 'object' && body !== null) {
    const envelope = (body as { error?: unknown }).error;
    if (typeof envelope === 'object' && envelope !== null) {
      const e = envelope as { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown };
      return new ApiError(
        status,
        typeof e.code === 'string' ? e.code : codeForStatus(status),
        typeof e.message === 'string' ? e.message : messageForStatus(status),
        typeof e.requestId === 'string' ? e.requestId : rid,
        e.details,
      );
    }
  }
  // The gateway's own refusals ({ message }) and anything unexpected.
  return new ApiError(status, codeForStatus(status), messageForStatus(status), rid);
}

function codeForStatus(status: number): string {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'REQUEST_FAILED';
}

/** Human messages for refusals that came without one of our own. */
export function messageForStatus(status: number): string {
  if (status === 401) return 'Please sign in to continue.';
  if (status === 403) return 'You don’t have access to this.';
  if (status === 404) return 'We couldn’t find that.';
  if (status === 413) return 'That’s too large to send.';
  if (status === 429)
    return 'That was a lot of requests in a short time. Please wait a minute and try again.';
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  return 'That didn’t work. Please try again.';
}

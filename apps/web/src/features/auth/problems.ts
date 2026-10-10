import { ApiError } from '@/lib/api/errors';

/** A refusal as a sign-in form shows it: what happened, what to do, and a reference for support. */
export interface Problem {
  title: string;
  detail?: string | undefined;
  reference?: string | undefined;
}

/** "14:35" in the person's own clock. */
export const clockIn = (seconds: number, now = Date.now()) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(now + seconds * 1000),
  );

/** The seconds the API asks to wait (ACCOUNT_LOCKED, RATE_LIMITED), if it said. */
export function waitSeconds(error: ApiError): number | null {
  const details = error.details as { retryAfterSeconds?: unknown } | undefined;
  const seconds = details?.retryAfterSeconds;
  return typeof seconds === 'number' && seconds > 0 ? seconds : null;
}

export function problemFrom(error: unknown, fallback: string): Problem {
  if (!(error instanceof ApiError)) return { title: fallback };
  const reference = error.isNetwork ? undefined : error.requestId;
  if (error.code === 'ACCOUNT_LOCKED') {
    const seconds = waitSeconds(error);
    return {
      title: 'Too many wrong passwords',
      detail: `${seconds ? `You can try again at ${clockIn(seconds)}` : 'You can try again later'}, or ask the business owner to reset your password.`,
      reference,
    };
  }
  if (error.code === 'RATE_LIMITED') {
    const seconds = waitSeconds(error);
    return {
      title: 'Too many tries in a short time',
      detail:
        seconds && seconds > 60
          ? `Please try again at ${clockIn(seconds)}.`
          : 'Please wait a minute and try again.',
      reference,
    };
  }
  return { title: error.message, reference };
}

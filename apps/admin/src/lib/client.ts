import { CSRF_HEADER } from '@buku/web-security/same-origin';

/** An answer from one of this app's own endpoints, in the browser. */
export type Result<T> =
  { ok: true; data: T } | { ok: false; code: string; message: string; reference?: string | undefined };

/**
 * POST to this app's own endpoint. The page never talks to the API itself and
 * never holds a token: the server does both. Our header marks the call as ours.
 */
export async function post<T>(path: `/api/${string}`, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        [CSRF_HEADER]: '1',
        accept: 'application/json',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'This app couldn’t be reached. Check your connection.',
    };
  }
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string; requestId?: string };
  } | null;
  if (res.ok) return { ok: true, data: json?.data as T };
  return {
    ok: false,
    code: json?.error?.code ?? 'ERROR',
    message: json?.error?.message ?? 'That didn’t work. Please try again.',
    reference: json?.error?.requestId,
  };
}

/** A text field's value from a submitted form ("" for anything else). */
export function fieldText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

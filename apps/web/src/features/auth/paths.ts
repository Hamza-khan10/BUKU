/** Addresses of the sign-in steps, each carrying where to go afterwards. */

/** Where a sign-in started, so "start again" leads back to the same form. */
export type SignInStart = 'signin' | 'business';

const withQuery = (path: string, query: Record<string, string | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value && !(key === 'next' && value === '/')) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

export const signInHref = (
  start: SignInStart,
  next: string,
  extra: Record<string, string | undefined> = {},
) => withQuery(start === 'business' ? '/signin/business' : '/signin', { ...extra, next });

export const verifyHref = (start: SignInStart, next: string) =>
  withQuery('/signin/verify', { next, start: start === 'business' ? 'business' : undefined });

export const newPasswordHref = (next: string) => withQuery('/signin/new-password', { next });

export const startFrom = (value: string | string[] | undefined): SignInStart =>
  (Array.isArray(value) ? value[0] : value) === 'business' ? 'business' : 'signin';

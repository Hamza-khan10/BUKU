/**
 * Where to go after signing in ("?next=/appointments/123"). Only a path on
 * this site is accepted — never another site (an "open redirect" would let a
 * link send people to a look-alike page right after they signed in).
 */
const MAX_LENGTH = 512;
// eslint-disable-next-line no-control-regex -- the point is to refuse control characters
const CONTROL = /[\u0000-\u001F\u007F]/;

export function safeNext(value: string | string[] | null | undefined, fallback = '/'): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw.length > MAX_LENGTH || CONTROL.test(raw)) return fallback;
  // A path on this site: one leading slash, not "//other.site" or "/\other.site".
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  let url: URL;
  try {
    url = new URL(raw, 'https://buku.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://buku.invalid') return fallback;
  // Never back to the sign-in pages themselves (a loop).
  if (url.pathname === '/signin' || url.pathname.startsWith('/signin/') || url.pathname === '/signout') {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

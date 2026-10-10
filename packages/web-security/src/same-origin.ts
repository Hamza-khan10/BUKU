/** The header our own scripts send; a page on another site can't send it without our permission. */
export const CSRF_HEADER = 'x-buku-csrf';

export type Refusal = { status: number; code: string; message: string };

/**
 * Only the site's own pages may use its API pass-through: the request must
 * carry our header (cross-site pages can't add custom headers without a CORS
 * grant, which we never give), and — where the browser says — come from this
 * site's origin. Changes (anything but GET/HEAD) must say where they came from.
 */
export function checkSameOrigin(
  method: string,
  headers: Headers,
  appOrigin: string,
  site = 'the BUKU website',
): Refusal | null {
  const refuse = { status: 403, code: 'FORBIDDEN', message: `This request didn’t come from ${site}.` };
  if (headers.get(CSRF_HEADER) !== '1') return refuse;
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return refuse;
  const origin = headers.get('origin');
  if (origin && origin !== appOrigin) return refuse;
  if (method !== 'GET' && method !== 'HEAD' && !origin && !fetchSite) return refuse;
  return null;
}

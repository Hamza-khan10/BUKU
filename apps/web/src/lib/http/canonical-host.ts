/**
 * The site has one address (APP_URL, D-136). On the live site, a page asked for at one of its other
 * addresses (www., or Cloudflare's workers.dev) is sent there for good: 308, so the method and body
 * are kept, with the same path and query. Search engines see one site; old links keep working.
 * Anything else (previews, local development, an address that isn't https) is left alone.
 */
export function canonicalRedirect(
  url: URL,
  host: string | null,
  siteAddress: string,
  live: boolean,
): URL | null {
  if (!live || !host) return null;
  let site: URL;
  try {
    site = new URL(siteAddress);
  } catch {
    return null;
  }
  if (site.protocol !== 'https:') return null;
  const asked = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (asked === site.hostname) return null;
  if (asked !== `www.${site.hostname}` && !asked.endsWith('.workers.dev')) return null;
  return new URL(`${url.pathname}${url.search}`, site.origin);
}

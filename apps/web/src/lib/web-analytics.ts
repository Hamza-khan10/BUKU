/**
 * Cloudflare Web Analytics (D-136): counts visits from real browsers only (it runs as a small
 * script, which crawlers and scanners don't), with no cookies and nothing that follows a person.
 * Its token is public (it sits in every page); set CF_WEB_ANALYTICS_TOKEN to turn it on. A value
 * that isn't one is ignored, so a typo can't put anything else into the page.
 */
export function webAnalyticsToken(): string | null {
  const token = process.env.CF_WEB_ANALYTICS_TOKEN?.trim();
  return token && /^[A-Za-z0-9]{16,64}$/.test(token) ? token : null;
}

/** The beacon's own settings, as Cloudflare reads them from the script tag. */
export const beaconSettings = (token: string) => JSON.stringify({ token, spa: true });

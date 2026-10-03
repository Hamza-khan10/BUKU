import { isIP } from 'node:net';

/**
 * The visitor's address, as told by the hosting platform (D-084). On Vercel
 * that is the `x-real-ip` header, which Vercel sets itself (a visitor can't
 * forge it). With no platform header configured (local development) there is
 * no trustworthy address, and the gateway uses the connection's own.
 */
export function clientIpFrom(headers: Headers, platformHeader: string | undefined): string | undefined {
  if (!platformHeader) return undefined;
  const value = headers.get(platformHeader)?.split(',')[0]?.trim();
  return value && isIP(value) ? value : undefined;
}

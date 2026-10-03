import type { NextConfig } from 'next';

/**
 * The BUKU website. Security headers that are the same for every response live
 * here; the Content-Security-Policy needs a fresh nonce per request, so it is
 * set in src/proxy.ts (WEB_PLAN §4).
 */
const securityHeaders = [
  // HTTPS only, for two years, subdomains included. (Not "preload" until the
  // production domain is final: preloading is very hard to undo.)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Location only where a page asks for it ("near me"); the camera only on the
  // check-in page (which overrides this header when it is built).
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()',
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // Shared with the API: the same clean-text rules (D-083), as TypeScript source.
  transpilePackages: ['@buku/validation'],
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
};

export default config;

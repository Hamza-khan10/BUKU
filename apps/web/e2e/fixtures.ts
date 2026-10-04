import { randomInt } from 'node:crypto';
import { test as base } from '@playwright/test';

/**
 * Each test is its own visitor. The live site's host tells the web server who
 * the visitor is (`x-real-ip` on Vercel), and the API limits sign-ins per
 * visitor (D-084). Tests send their own address the same way, so they don't
 * all count against one — which the development web server honours when
 * WEB_CLIENT_IP_HEADER=x-real-ip (apps/web/.env.example). Without it, they
 * simply share the development machine's address, as before.
 */

/** A fresh address from 198.18.0.0/15, the block set aside for testing (RFC 2544). */
export const visitorAddress = () => `198.${18 + randomInt(2)}.${randomInt(256)}.${1 + randomInt(254)}`;

export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({ ...extraHTTPHeaders, 'x-real-ip': visitorAddress() });
  },
});

export { expect } from '@playwright/test';

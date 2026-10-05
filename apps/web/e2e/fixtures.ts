import { randomInt } from 'node:crypto';
import { test as base } from '@playwright/test';

/**
 * Each test is its own visitor. The live site's host tells the web server who
 * the visitor is (`x-real-ip` on Vercel), and the API limits each visitor —
 * sign-ins, searches, everything (D-084, D-089). Tests send their own address
 * the same way, so they don't all count against one — which the development
 * web server honours when WEB_CLIENT_IP_HEADER=x-real-ip (apps/web/.env.example).
 * Without it, they simply share the development machine's address. Every
 * spec imports `test` from here.
 */

/** A fresh address from 198.18.0.0/15, the block set aside for testing (RFC 2544). */
export const visitorAddress = () => `198.${18 + randomInt(2)}.${randomInt(256)}.${1 + randomInt(254)}`;

export const test = base.extend<{ ownAddress: boolean }>({
  /**
   * The browser sends this header to every site the page talks to, not only
   * ours. A test whose page talks to another site — a picture goes straight
   * to storage, which allows only the headers it expects — turns it off
   * (`test.use({ ownAddress: false })`) and shares this machine's address.
   */
  ownAddress: [true, { option: true }],
  extraHTTPHeaders: async ({ extraHTTPHeaders, ownAddress }, provide) => {
    await provide(ownAddress ? { ...extraHTTPHeaders, 'x-real-ip': visitorAddress() } : extraHTTPHeaders);
  },
});

export { expect } from '@playwright/test';

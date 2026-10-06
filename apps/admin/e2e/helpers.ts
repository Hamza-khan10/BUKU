import { createHmac, randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

/** Each test is its own visitor (the dev admin app honours x-real-ip, like the website). */
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({
      ...extraHTTPHeaders,
      'x-real-ip': `198.${18 + randomInt(2)}.${randomInt(256)}.${1 + randomInt(254)}`,
    });
  },
});
export { expect };

export const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

export async function apiAvailable(): Promise<boolean> {
  try {
    return (await fetch(`${API}/v1/categories`, { signal: AbortSignal.timeout(5000) })).ok;
  } catch {
    return false;
  }
}

export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(secret: string): Buffer {
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase())
    bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The code an authenticator app would show now (RFC 6238, 30 s, 6 digits). */
export function totp(secret: string, steps = 0, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000) + steps));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Development sign-in on the admin app; lands wherever the app sends the account next. */
export async function devSignIn(page: Page, email: string, name = 'Operator Test') {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

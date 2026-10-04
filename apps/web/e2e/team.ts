import { createHmac, randomBytes } from 'node:crypto';
import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { visitorAddress } from './fixtures';

/**
 * Setting up what employee sign-in tests need, through the web server like
 * the site itself would: a business owner, their business, and employee
 * accounts. Each helper is its own visitor with its own cookies.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

/** A separate visitor (own address, own cookies) that calls the API through the web server. */
export function visitor(baseURL: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-buku-csrf': '1', origin: baseURL, 'x-real-ip': visitorAddress() },
  });
}

async function data<T>(response: Promise<APIResponse>): Promise<T> {
  const res = await response;
  const body = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null;
  expect(res.ok(), `${res.url()} → ${res.status()} ${JSON.stringify(body?.error)}`).toBe(true);
  return body?.data as T;
}

export interface Team {
  owner: APIRequestContext;
  business: { id: string; slug: string };
}

/**
 * The test business, made once and reused by every run (so test runs don't
 * keep adding businesses to the development database).
 */
export async function teamBusiness(baseURL: string): Promise<Team> {
  const owner = await visitor(baseURL);
  await data(
    owner.post('/api/v1/auth/dev/login', {
      data: { email: 'e2e.team.owner@example.com', name: 'Team Owner', role: 'business_owner' },
    }),
  );
  const mine = await data<{ id: string; slug: string }[]>(owner.get('/api/v1/businesses/mine'));
  if (mine[0]) return { owner, business: mine[0] };

  const sample = (await (await fetch(`${API}/v1/businesses/search?limit=1`)).json()) as {
    data: { slug: string }[];
  };
  const profile = (await (await fetch(`${API}/v1/businesses/${sample.data[0]!.slug}`)).json()) as {
    data: { category: { id: string } };
  };
  const business = await data<{ id: string; slug: string }>(
    owner.post('/api/v1/businesses', {
      data: {
        name: 'Team Sign-in Test Studio',
        categoryId: profile.data.category.id,
        address: '1 Test Street',
        city: 'Lahore',
        country: 'PK',
        lat: 31.5204,
        lng: 74.3587,
        timezone: 'Asia/Karachi',
        currency: 'PKR',
        acceptedBusinessTermsVersion: '1.0',
      },
    }),
  );
  return { owner, business };
}

export interface Employee {
  id: string;
  name: string;
  username: string;
  temporaryPassword: string;
}

/** A new employee account on the test business, with the temporary password the owner would hand over. */
export async function addEmployee(team: Team, first: string): Promise<Employee> {
  const username = `${first.toLowerCase()}.${randomBytes(5).toString('hex')}`;
  const name = `${first} Tester`;
  const created = await data<{ member: { id: string }; temporaryPassword: string }>(
    team.owner.post(`/api/v1/businesses/${team.business.id}/members`, {
      data: { name, username, role: 'front_desk' },
    }),
  );
  return { id: created.member.id, name, username, temporaryPassword: created.temporaryPassword };
}

export async function removeEmployee(team: Team, employee: Employee) {
  await team.owner.delete(`/api/v1/businesses/${team.business.id}/members/${employee.id}`);
}

/**
 * An employee with their own password and two-step sign-in on, as if they had
 * set it up themselves. Returns the authenticator secret and recovery codes.
 */
export async function withTwoStep(baseURL: string, team: Team, employee: Employee, password: string) {
  const device = await visitor(baseURL);
  const signIn = (pw: string) =>
    data(
      device.post('/api/v1/auth/business-login', {
        data: { business: team.business.slug, username: employee.username, password: pw },
      }),
    );
  await signIn(employee.temporaryPassword);
  await data(
    device.post('/api/v1/auth/password', {
      data: { currentPassword: employee.temporaryPassword, newPassword: password },
    }),
  );
  await signIn(password);
  const { secret } = await data<{ secret: string }>(device.post('/api/v1/auth/mfa/setup'));
  // The previous 30-second step: still accepted now, and leaves the current one free for the test.
  const { recoveryCodes } = await data<{ recoveryCodes: string[] }>(
    device.post('/api/v1/auth/mfa/confirm', { data: { code: totp(secret, -1) } }),
  );
  await device.dispose();
  return { secret, recoveryCodes };
}

// ── Authenticator codes (RFC 6238), as an authenticator app computes them ──

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret.replace(/=+$/, '')) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code for now (or `steps` 30-second steps away). */
export function totp(secret: string, steps = 0, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000) + steps));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

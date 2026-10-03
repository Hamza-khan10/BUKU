import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { secureCookies } from '../env';
import { clearedCookies, cookieNames, sessionCookies, type CookieSpec, type SessionTokens } from './policy';

/** The tokens this browser holds (server-side only). */
export function readSession(request: NextRequest) {
  const names = cookieNames(secureCookies());
  return {
    accessToken: request.cookies.get(names.access)?.value || undefined,
    refreshToken: request.cookies.get(names.refresh)?.value || undefined,
  };
}

function apply(response: NextResponse, specs: CookieSpec[]) {
  for (const { name, value, ...options } of specs) response.cookies.set(name, value, options);
}

export function setSession(response: NextResponse, tokens: SessionTokens) {
  apply(response, sessionCookies(tokens, secureCookies()));
}

export function clearSession(response: NextResponse) {
  apply(response, clearedCookies(secureCookies()));
}

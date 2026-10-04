import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { secureCookies } from '../env';
import {
  challengeCookie,
  clearedChallengeCookie,
  clearedCookies,
  cookieNames,
  readChallengeValue,
  sessionCookies,
  type Challenge,
  type CookieSpec,
  type SessionTokens,
} from './policy';

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

/** The sign-in waiting for its two-step code in this browser, if any (server-side only). */
export function readChallenge(request: NextRequest): Challenge | null {
  return readChallengeValue(request.cookies.get(cookieNames(secureCookies()).challenge)?.value);
}

export function setChallenge(response: NextResponse, challenge: Challenge) {
  apply(response, [challengeCookie(challenge, secureCookies())]);
}

export function clearChallenge(response: NextResponse) {
  apply(response, [clearedChallengeCookie(secureCookies())]);
}

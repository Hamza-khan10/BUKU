import 'server-only';
import {
  challengeCookie,
  clearedChallengeCookie,
  googleFlowCookie,
  clearedCookies,
  cookieNames,
  readChallengeValue,
  sessionCookies,
  type Challenge,
  type CookieSpec,
  type SessionTokens,
} from '@buku/web-security/session-policy';
import type { NextResponse } from 'next/server';
import { secureCookies } from './env';

/** The admin app's cookies: never the website's names, even in the same browser (D-091). */
const PREFIX = 'buku_admin';

export const names = () => cookieNames(secureCookies(), PREFIX);

/** Anything that hands out cookies by name: a request's cookies, or next/headers' cookies(). */
interface CookieSource {
  get(name: string): { value: string } | undefined;
}

export function readTokens(jar: CookieSource) {
  const n = names();
  return {
    accessToken: jar.get(n.access)?.value || undefined,
    refreshToken: jar.get(n.refresh)?.value || undefined,
    signedIn: Boolean(jar.get(n.hint)?.value),
  };
}

export function readChallenge(jar: CookieSource): Challenge | null {
  return readChallengeValue(jar.get(names().challenge)?.value);
}

function apply(response: NextResponse, specs: CookieSpec[]) {
  for (const { name, value, ...options } of specs) response.cookies.set(name, value, options);
}

export function setSession(response: NextResponse, tokens: SessionTokens) {
  apply(response, sessionCookies(tokens, secureCookies(), Date.now(), PREFIX));
  apply(response, [clearedChallengeCookie(secureCookies(), PREFIX)]);
}

export function clearSession(response: NextResponse) {
  apply(response, [
    ...clearedCookies(secureCookies(), PREFIX),
    clearedChallengeCookie(secureCookies(), PREFIX),
  ]);
}

export function setChallenge(response: NextResponse, challenge: Challenge) {
  apply(response, [challengeCookie(challenge, secureCookies(), Date.now(), PREFIX)]);
}

/** A Google sign-in in progress (the shared flow's cookie, under this app's name). */
export const readGoogleFlow = (jar: CookieSource) => jar.get(names().google)?.value || undefined;

export function setGoogleFlow(response: NextResponse, value: string, maxAge: number) {
  apply(response, [googleFlowCookie(value, secureCookies(), maxAge, PREFIX)]);
}

export function clearGoogleFlow(response: NextResponse) {
  apply(response, [googleFlowCookie('', secureCookies(), 0, PREFIX)]);
}

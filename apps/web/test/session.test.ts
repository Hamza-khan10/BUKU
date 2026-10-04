import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { apiErrorFrom } from '../src/lib/api/errors';
import {
  ACCESS_SKEW_SECONDS,
  challengeCookie,
  clearedChallengeCookie,
  clearedCookies,
  cookieNames,
  readChallengeValue,
  sessionCookies,
  takeChallenge,
  takeSession,
} from '../src/lib/session/policy';
import { initials } from '../src/components/ui/avatar';

const now = Date.parse('2026-10-04T10:00:00Z');
const tokens = {
  accessToken: 'access.jwt',
  accessTokenExpiresAt: '2026-10-04T10:15:00Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2027-04-02T10:00:00Z',
};

describe('session cookies', () => {
  it('use the browser-enforced prefixes over HTTPS only', () => {
    expect(cookieNames(true)).toEqual({
      access: '__Host-buku_at',
      refresh: '__Secure-buku_rt',
      hint: '__Host-buku_s',
      challenge: '__Host-buku_mfa',
    });
    expect(cookieNames(false)).toEqual({
      access: 'buku_at',
      refresh: 'buku_rt',
      hint: 'buku_s',
      challenge: 'buku_mfa',
    });
  });

  it('keep tokens away from scripts; the refresh token only goes to /api', () => {
    const [access, refresh, hint] = sessionCookies(tokens, true, now);
    expect(access).toMatchObject({
      name: '__Host-buku_at',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(refresh).toMatchObject({
      name: '__Secure-buku_rt',
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
    });
    expect(hint).toMatchObject({ name: '__Host-buku_s', httpOnly: false, path: '/' });
    // The hint carries no secret: only when the access token lapses.
    expect(hint!.value).toMatch(/^\d+$/);
    expect(hint!.value).not.toContain(tokens.accessToken);
  });

  it('let the access cookie lapse just before the token does; the others last as long as the session', () => {
    const [access, refresh, hint] = sessionCookies(tokens, false, now);
    expect(access!.maxAge).toBe(15 * 60 - ACCESS_SKEW_SECONDS);
    expect(refresh!.maxAge).toBe(Math.floor((Date.parse(tokens.refreshTokenExpiresAt) - now) / 1000));
    expect(hint!.maxAge).toBe(refresh!.maxAge);
    expect(Number(hint!.value)).toBe(now / 1000 + access!.maxAge);
  });

  it('are all removed on sign-out, on the same paths they were set on', () => {
    const cleared = clearedCookies(true);
    expect(cleared.map((c) => [c.name, c.path, c.maxAge])).toEqual([
      ['__Host-buku_at', '/', 0],
      ['__Secure-buku_rt', '/api', 0],
      ['__Host-buku_s', '/', 0],
    ]);
  });
});

describe('tokens in API answers never reach the browser', () => {
  it('takes a session from a sign-in answer', () => {
    const { tokens: taken, data } = takeSession({
      user: { id: 'u1' },
      isNewUser: true,
      sessionId: 's1',
      ...tokens,
    });
    expect(taken).toEqual(tokens);
    expect(data).toEqual({ user: { id: 'u1' }, isNewUser: true, sessionId: 's1' });
    expect(JSON.stringify(data)).not.toContain('refresh-token');
  });

  it('takes a session nested in an answer (two-step setup confirmed)', () => {
    const { tokens: taken, data } = takeSession({
      enabled: true,
      recoveryCodes: ['AAAA-BBBB'],
      session: tokens,
    });
    expect(taken).toEqual(tokens);
    expect(data).toEqual({ enabled: true, recoveryCodes: ['AAAA-BBBB'], session: { renewed: true } });
  });

  it('leaves other answers alone', () => {
    expect(takeSession({ mfaRequired: true, mfaToken: 'challenge' })).toEqual({
      tokens: null,
      data: { mfaRequired: true, mfaToken: 'challenge' },
    });
    expect(takeSession([1, 2]).tokens).toBeNull();
    expect(takeSession(null).tokens).toBeNull();
    expect(takeSession({ accessToken: 'only-one' }).tokens).toBeNull();
  });
});

describe('two-step sign-in: the challenge never reaches the browser', () => {
  // Made at runtime, like the API's (a literal would look like a leaked key to the secret scan).
  const token = randomBytes(32).toString('base64url');
  const answer = { mfaRequired: true, mfaToken: token, expiresAt: '2026-10-04T10:05:00Z' };

  it('takes the token out of a sign-in answer, leaving only that a code is needed', () => {
    const { challenge, data } = takeChallenge(answer);
    expect(challenge).toEqual({ token, expiresAt: '2026-10-04T10:05:00Z' });
    expect(data).toEqual({ mfaRequired: true, expiresAt: '2026-10-04T10:05:00Z' });
    expect(JSON.stringify(data)).not.toContain(token);
  });

  it('leaves every other answer alone', () => {
    for (const other of [null, [answer], { mfaRequired: 'yes', mfaToken: token }, { mfaToken: token }]) {
      expect(takeChallenge(other)).toEqual({ challenge: null, data: other });
    }
  });

  it('never passes on a token it won’t keep (odd characters): taken out, not stored', () => {
    expect(takeChallenge({ ...answer, mfaToken: 'a;b=c' })).toEqual({
      challenge: null,
      data: { mfaRequired: true, expiresAt: answer.expiresAt },
    });
  });

  it('keeps it in a cookie scripts can’t read, sent only by our own pages, for as long as it lasts', () => {
    const cookie = challengeCookie({ token, expiresAt: '2026-10-04T10:05:00Z' }, true, now);
    expect(cookie).toMatchObject({
      name: '__Host-buku_mfa',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 300,
    });
    expect(clearedChallengeCookie(false)).toMatchObject({ name: 'buku_mfa', value: '', maxAge: 0 });
  });

  it('reads the cookie back while it lasts, and refuses anything malformed', () => {
    const { value } = challengeCookie({ token, expiresAt: '2026-10-04T10:05:00Z' }, false, now);
    expect(readChallengeValue(value, now)).toEqual({ token, expiresAt: '2026-10-04T10:05:00.000Z' });
    expect(readChallengeValue(value, Date.parse('2026-10-04T10:05:00Z'))).toBeNull();
    for (const bad of [
      undefined,
      '',
      token,
      `.${token}`,
      `soon.${token}`,
      '1791108300.short',
      '1791108300.a b',
    ]) {
      expect(readChallengeValue(bad, now)).toBeNull();
    }
  });
});

describe('API errors', () => {
  it('read the API envelope, with validation issues by field', () => {
    const e = apiErrorFrom(
      400,
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          requestId: 'req-12345678',
          details: [{ path: 'name', message: 'Emojis and picture symbols can’t be used here.' }],
        },
      },
      'header-id',
    );
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'req-12345678' });
    expect(e.fieldIssues).toEqual([
      { path: 'name', message: 'Emojis and picture symbols can’t be used here.' },
    ]);
  });

  it("turn the gateway's own refusals and junk into readable errors", () => {
    expect(apiErrorFrom(401, { message: 'Unauthorized' }, 'rid-12345678')).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Please sign in to continue.',
      requestId: 'rid-12345678',
    });
    expect(apiErrorFrom(429, null)).toMatchObject({ code: 'RATE_LIMITED' });
    expect(apiErrorFrom(502, '<html>bad gateway</html>')).toMatchObject({ code: 'SERVER_ERROR' });
    expect(apiErrorFrom(404, null).fieldIssues).toEqual([]);
  });
});

describe('initials', () => {
  it('work in any script', () => {
    expect(initials('Ayesha Noor Khan')).toBe('AK');
    expect(initials('sara')).toBe('S');
    expect(initials('  ')).toBe('');
    expect(initials('عائشہ خان')).toBe('عخ');
  });
});

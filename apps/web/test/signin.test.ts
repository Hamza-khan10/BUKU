import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codeDigits, looksLikeRecoveryCode, recoveryChars } from '../src/features/auth/codes';
import { businessHandleFrom, usernameFrom } from '../src/features/auth/handles';
import { newPasswordHref, signInHref, startFrom, verifyHref } from '../src/features/auth/paths';
import { clockIn, problemFrom, waitSeconds } from '../src/features/auth/problems';
import { ApiError } from '../src/lib/api/errors';

describe('what employees type to sign in', () => {
  it('takes the business handle as typed, with an @, or from its pasted link', () => {
    expect(businessHandleFrom('salt-and-pepper')).toBe('salt-and-pepper');
    expect(businessHandleFrom('  Salt-And-Pepper ')).toBe('salt-and-pepper');
    expect(businessHandleFrom('@salt-and-pepper')).toBe('salt-and-pepper');
    expect(businessHandleFrom('https://thebuku.vercel.app/b/salt-and-pepper')).toBe('salt-and-pepper');
    expect(businessHandleFrom('thebuku.vercel.app/b/salt-and-pepper/book?x=1#top')).toBe('salt-and-pepper');
    expect(businessHandleFrom('/b/fade-masters-lahore')).toBe('fade-masters-lahore');
  });

  it('refuses what can’t be a handle', () => {
    for (const bad of [
      '',
      '   ',
      'salt and pepper',
      '-salt',
      'salt-',
      'https://evil.example/',
      'a'.repeat(121),
    ]) {
      expect(businessHandleFrom(bad)).toBeNull();
    }
    expect(businessHandleFrom(undefined)).toBeNull();
  });

  it('reads usernames the way the API compares them', () => {
    expect(usernameFrom(' Ali.Raza ')).toBe('ali.raza');
    expect(usernameFrom('front_desk-2')).toBe('front_desk-2');
    for (const bad of ['al', '.ali', 'ali raza', 'a'.repeat(41), '']) expect(usernameFrom(bad)).toBeNull();
  });
});

describe('the sign-in steps’ addresses', () => {
  it('carry where to go next, and leave out the home page', () => {
    expect(signInHref('signin', '/')).toBe('/signin');
    expect(signInHref('business', '/pricing')).toBe('/signin/business?next=%2Fpricing');
    expect(signInHref('business', '/', { business: 'salt', username: 'ali', password: undefined })).toBe(
      '/signin/business?business=salt&username=ali',
    );
    expect(verifyHref('signin', '/help')).toBe('/signin/verify?next=%2Fhelp');
    expect(verifyHref('business', '/')).toBe('/signin/verify?start=business');
    expect(newPasswordHref('/business')).toBe('/signin/new-password?next=%2Fbusiness');
  });

  it('know only two places a sign-in can start', () => {
    expect(startFrom('business')).toBe('business');
    expect(startFrom(['business', 'x'])).toBe('business');
    expect(startFrom('admin')).toBe('signin');
    expect(startFrom(undefined)).toBe('signin');
  });
});

describe('the two-step code', () => {
  it('keeps only the digits of a pasted code', () => {
    expect(codeDigits('123 456')).toBe('123456');
    expect(codeDigits('123-456')).toBe('123456');
    expect(codeDigits(' 1234567 ')).toBe('123456');
    expect(codeDigits('abc')).toBe('');
  });

  it('tells a recovery code from an app code', () => {
    expect(looksLikeRecoveryCode('k7qx-2m9p')).toBe(true);
    expect(looksLikeRecoveryCode('K7QX 2M9P')).toBe(true);
    expect(looksLikeRecoveryCode('12345678')).toBe(false);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
    expect(recoveryChars('k7qx-2m9p')).toBe('K7QX2M9P');
  });
});

describe('refusals, in words', () => {
  const reference = randomUUID();

  it('says when a locked account can try again', () => {
    const locked = new ApiError(429, 'ACCOUNT_LOCKED', 'Locked.', reference, { retryAfterSeconds: 600 });
    expect(waitSeconds(locked)).toBe(600);
    const problem = problemFrom(locked, 'fallback');
    expect(problem.title).toBe('Too many wrong passwords');
    expect(problem.detail).toContain(clockIn(600));
    expect(problem.detail).toContain('ask the business owner to reset your password');
    expect(problem.reference).toBe(reference);
  });

  it('too many tries: plain words, and when to try again if it’s more than a minute', () => {
    const soon = problemFrom(
      new ApiError(429, 'RATE_LIMITED', 'Too many requests, please slow down', reference, {
        retryAfterSeconds: 40,
      }),
      'x',
    );
    expect(soon).toEqual({
      title: 'Too many tries in a short time',
      detail: 'Please wait a minute and try again.',
      reference,
    });
    const later = problemFrom(
      new ApiError(429, 'RATE_LIMITED', 'Too many', reference, { retryAfterSeconds: 900 }),
      'x',
    );
    expect(later.detail).toBe(`Please try again at ${clockIn(900)}.`);
  });

  it('passes the API’s own message on, without a reference for network failures', () => {
    expect(problemFrom(new ApiError(403, 'ACCOUNT_SUSPENDED', 'Access is off.', reference), 'x')).toEqual({
      title: 'Access is off.',
      reference,
    });
    expect(
      problemFrom(new ApiError(0, 'NETWORK_ERROR', 'No network.', reference), 'x').reference,
    ).toBeUndefined();
    expect(problemFrom(new Error('boom'), 'Signing in didn’t work.')).toEqual({
      title: 'Signing in didn’t work.',
    });
  });
});

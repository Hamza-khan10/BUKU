import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/lib/session/next';

describe('where to go after signing in', () => {
  it('keeps a path on this site, with its query and anchor', () => {
    expect(safeNext('/appointments/123')).toBe('/appointments/123');
    expect(safeNext('/b/salt-and-pepper?service=abc#reviews')).toBe('/b/salt-and-pepper?service=abc#reviews');
    expect(safeNext(['/pricing', '/other'])).toBe('/pricing');
  });

  it('never leads to another site (open redirect)', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example/path',
      '/\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '/%0d%0aSet-Cookie:x=1'.replace('%0d%0a', '\r\n'),
      '/'.padEnd(600, 'a'),
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });

  it('never back to the sign-in pages (a loop), and falls back when empty', () => {
    expect(safeNext('/signin')).toBe('/');
    expect(safeNext('/signin/verify?x=1')).toBe('/');
    expect(safeNext('/signout')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('', '/account')).toBe('/account');
  });
});

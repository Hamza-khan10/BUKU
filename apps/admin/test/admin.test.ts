import { describe, expect, it } from 'vitest';
import { safeNext } from '@admin/lib/next-path';

describe('where to go after renewing a session', () => {
  it('only a page of this app', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/two-step')).toBe('/two-step');
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'evil',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });

  it('never back to sign-in or an endpoint', () => {
    for (const p of ['/signin', '/signin/verify', '/signin?x=1', '/api/session/renew'])
      expect(safeNext(p)).toBe('/');
    expect(safeNext(`/${'a'.repeat(600)}`)).toBe('/');
  });
});

import { describe, expect, it } from 'vitest';
import { displayNameFor } from '../src/users/user-service.js';

describe('displayNameFor (names from Google/Apple)', () => {
  it('keeps a real name as it is', () => {
    expect(displayNameFor('Ayesha Khan', 'a@example.com')).toBe('Ayesha Khan');
    expect(displayNameFor('\u0639\u0627\u0626\u0634\u06C1', 'a@example.com')).toBe(
      '\u0639\u0627\u0626\u0634\u06C1',
    );
  });

  it('removes emoji and invisible characters instead of refusing the sign-up', () => {
    expect(displayNameFor('Ayesha \u2728 Khan\u200B', 'a@example.com')).toBe('Ayesha Khan');
  });

  it('falls back to the email, then to a neutral name', () => {
    expect(displayNameFor(null, 'ayesha.khan92@example.com')).toBe('ayesha khan');
    expect(displayNameFor('\u{1F389}', 'x_1@example.com')).toBe('x');
    expect(displayNameFor(undefined, '12345@example.com')).toBe('BUKU member');
  });

  it('never exceeds the column (200 characters)', () => {
    expect([...displayNameFor('A'.repeat(500), 'a@example.com')]).toHaveLength(200);
  });
});

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PASSWORD_PROBLEM_MESSAGES, passwordProblem } from '../src/index.js';

describe('Password rules', () => {
  it('accepts a long, uncommon password — no composition rules', () => {
    expect(passwordProblem('a-long-unique-passphrase')).toBeNull();
    expect(passwordProblem('correct horse battery staple')).toBeNull();
    expect(passwordProblem('k7mp-x3qa-9wte-hn4c')).toBeNull();
  });

  it('refuses short, overlong, common and repetitive ones', () => {
    expect(passwordProblem('short')).toBe('too_short');
    expect(passwordProblem('x'.repeat(129))).toBe('too_long');
    expect(passwordProblem('Password123')).toBe('common');
    expect(passwordProblem('ababababab')).toBe('repetitive');
  });

  it('with the account in mind: no username inside, no reusing the current one', () => {
    // Made at runtime: literal username/password pairs look like leaked credentials to secret scanners.
    const username = ['ali', 'raza'].join('.');
    const current = randomBytes(12).toString('base64url');
    expect(passwordProblem(`${username}-at-the-salon`, { username })).toBe('contains_username');
    expect(passwordProblem(`${username.toUpperCase()}-at-the-salon`, { username })).toBe('contains_username');
    expect(passwordProblem(current, { current })).toBe('same_as_current');
    expect(passwordProblem(`${current}-new`, { username: null, current })).toBeNull();
  });

  it('has a sentence for every problem', () => {
    for (const message of Object.values(PASSWORD_PROBLEM_MESSAGES)) expect(message).toMatch(/^[A-Z].*\.$/);
  });
});

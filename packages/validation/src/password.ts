/**
 * Password rules, shared by the API (authoritative) and the apps (instant
 * feedback). Aligned with NIST SP 800-63B: length over composition rules —
 * no "one capital, one symbol" demands, which make passwords harder to
 * remember without making them harder to guess. The upper bound keeps
 * hashing cheap enough that megabyte-long passwords can't slow the server.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** The passwords tried first by anyone guessing; refused outright. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'qwerty1234',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'admin12345',
  'abc1234567',
  '1q2w3e4r5t',
  'pakistan123',
  'buku123456',
  'bukupassword',
]);

export type PasswordProblem =
  'too_short' | 'too_long' | 'common' | 'repetitive' | 'contains_username' | 'same_as_current';

/**
 * What's wrong with a new password, or null. With `username` and `current`,
 * also refuses one that contains the username or repeats the old password.
 */
export function passwordProblem(
  password: string,
  context: { username?: string | null | undefined; current?: string | undefined } = {},
): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'common';
  if (new Set(password).size < 4) return 'repetitive';
  if (context.username && password.toLowerCase().includes(context.username.toLowerCase())) {
    return 'contains_username';
  }
  if (context.current !== undefined && password === context.current) return 'same_as_current';
  return null;
}

/** What to tell a person, in a sentence. */
export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  common: 'That password is one of the first anyone would guess. Choose another.',
  repetitive: 'Use more than a few different characters.',
  contains_username: 'Your password must not contain your username.',
  same_as_current: 'Choose a password different from the current one.',
};

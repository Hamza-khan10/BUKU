import 'server-only';
import { cookies } from 'next/headers';
import { cookieNames, readChallengeValue, type Challenge } from './policy';

/**
 * What a page can know about this browser's sign-in while it renders. Both
 * cookie spellings are checked (the __Host- one over HTTPS, the plain one on
 * http://localhost), so pages don't need the API settings to answer.
 */
const spellings = (key: 'hint' | 'challenge') => [cookieNames(true)[key], cookieNames(false)[key]];

/** Someone is signed in here (the session hint cookie: no secret, just "yes"). */
export async function signedInHere(): Promise<boolean> {
  const jar = await cookies();
  return spellings('hint').some((name) => jar.has(name));
}

/** A sign-in waiting for its two-step code in this browser, still in time. */
export async function pendingChallenge(): Promise<Challenge | null> {
  const jar = await cookies();
  for (const name of spellings('challenge')) {
    const challenge = readChallengeValue(jar.get(name)?.value);
    if (challenge) return challenge;
  }
  return null;
}

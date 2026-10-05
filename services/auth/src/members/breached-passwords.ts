import { createHash } from 'node:crypto';

/**
 * Has this password appeared in a known data breach?
 *
 * Have I Been Pwned's "range" API (k-anonymity): only the first 5 characters
 * of the password's SHA-1 leave this server; the answer lists every breached
 * hash with that prefix (padded with fake entries, so the response size says
 * nothing either), and the match is made here. The password itself, and even
 * its full hash, are never sent anywhere.
 */
export interface BreachedPasswords {
  /** How many breaches the password was seen in (0: none), or null when it couldn't be checked. */
  timesSeen(password: string): Promise<number | null>;
}

export class PwnedPasswords implements BreachedPasswords {
  constructor(
    private readonly options: {
      /** https://api.pwnedpasswords.com */
      baseUrl: string;
      timeoutMs: number;
      fetch?: typeof fetch;
    },
  ) {}

  async timesSeen(password: string): Promise<number | null> {
    const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const call = this.options.fetch ?? fetch;
    try {
      const res = await call(`${this.options.baseUrl.replace(/\/+$/, '')}/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'BUKU-auth-service' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!res.ok) return null;
      for (const line of (await res.text()).split('\n')) {
        const [candidate, count] = line.trim().split(':');
        if (candidate === suffix) return Number(count) || 0; // padding entries have a count of 0
      }
      return 0;
    } catch {
      return null;
    }
  }
}

/** For tests and for switching the check off: nothing is ever "seen". */
export const noBreachCheck: BreachedPasswords = { timesSeen: () => Promise.resolve(0) };

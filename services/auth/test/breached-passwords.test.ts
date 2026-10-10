import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PwnedPasswords } from '../src/members/breached-passwords.js';

/** Have I Been Pwned's range API, faked: what was asked, and a chosen answer. */
function fakeHibp(answer: (prefix: string) => Response | Promise<Response>) {
  const asked: { url: string; headers: Headers }[] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    asked.push({ url, headers: new Headers(init?.headers) });
    return Promise.resolve(answer(url.slice(-5)));
  }) as unknown as typeof fetch;
  return { asked, fetchFn };
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase();

describe('breached-password check (k-anonymity)', () => {
  it('sends only the first 5 characters of the hash, asks for padding, and finds the match here', async () => {
    const password = ['correct', 'horse', 'battery'].join(' ');
    const hash = sha1(password);
    const { asked, fetchFn } = fakeHibp(
      () => new Response([`${'0'.repeat(35)}:0`, `${hash.slice(5)}:52`, `${'F'.repeat(35)}:3`].join('\r\n')),
    );
    const check = new PwnedPasswords({ baseUrl: 'https://hibp.test/', timeoutMs: 1000, fetch: fetchFn });
    expect(await check.timesSeen(password)).toBe(52);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe(`https://hibp.test/range/${hash.slice(0, 5)}`);
    expect(asked[0]!.url).not.toContain(hash.slice(5));
    expect(asked[0]!.headers.get('add-padding')).toBe('true');
  });

  it('not in any breach (padding entries with a count of 0 don’t count)', async () => {
    const password = ['quiet', 'teal', 'lantern', '41'].join('-');
    const { fetchFn } = fakeHibp(() => new Response(`${sha1(password).slice(5)}:0\n${'A'.repeat(35)}:9`));
    const check = new PwnedPasswords({ baseUrl: 'https://hibp.test', timeoutMs: 1000, fetch: fetchFn });
    expect(await check.timesSeen(password)).toBe(0);
  });

  it('unreachable, slow or failing: says it couldn’t check (null), never throws', async () => {
    const down = fakeHibp(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(
      await new PwnedPasswords({ baseUrl: 'https://x', timeoutMs: 1000, fetch: down.fetchFn }).timesSeen('a'),
    ).toBeNull();
    const failing = fakeHibp(() => new Response('busy', { status: 503 }));
    expect(
      await new PwnedPasswords({ baseUrl: 'https://x', timeoutMs: 1000, fetch: failing.fetchFn }).timesSeen(
        'a',
      ),
    ).toBeNull();
    const slow = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const started = Date.now();
    expect(
      await new PwnedPasswords({ baseUrl: 'https://x', timeoutMs: 200, fetch: slow }).timesSeen('a'),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

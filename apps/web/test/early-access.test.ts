import { afterEach, describe, expect, it, vi } from 'vitest';
import { EarlyAccessInput, fieldProblems } from '../src/features/early-access/schema';
import {
  earlyAccessSettings,
  hashAddress,
  passedBotCheck,
  rowOf,
  saveSignup,
  saveToTestStore,
  type EarlyAccessSettings,
} from '../src/features/early-access/server';

const business = {
  kind: 'business',
  email: '  Hina@Example.COM ',
  name: 'Hina Qureshi',
  businessName: 'Happy Tails Clinic',
  businessType: 'Veterinary clinic',
  branches: '2-5',
  city: 'Lahore',
  country: 'pk',
  whatsapp: '+92 300 123-4567',
  planInterest: 'network',
  consent: true,
  utmSource: 'instagram',
};

const settings: EarlyAccessSettings = {
  supabaseUrl: 'https://abc.supabase.co/',
  supabaseKey: 'sb_secret_test',
  turnstileSiteKey: 'site',
  turnstileSecret: 'secret',
  hashSecret: 'x'.repeat(32),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Early access: what’s accepted', () => {
  it('takes a business’s details, cleaned: email lowercase, phone and country in their stored form', () => {
    const parsed = EarlyAccessInput.parse(business);
    expect(parsed).toMatchObject({
      email: 'hina@example.com',
      whatsapp: '+923001234567',
      country: 'PK',
      branches: '2-5',
      planInterest: 'network',
    });
  });

  it('takes someone who books with only an email, a city and their yes', () => {
    expect(
      EarlyAccessInput.safeParse({
        kind: 'customer',
        email: 'a@b.pk',
        city: 'Karachi',
        country: 'PK',
        consent: true,
      }).success,
    ).toBe(true);
  });

  it('refuses what could corrupt the list, and says why in plain words', () => {
    const bad = EarlyAccessInput.safeParse({
      ...business,
      name: 'Hina 😀',
      businessName: 'X',
      email: 'not an email',
      whatsapp: '0300-1234567',
      consent: false,
      branches: '3',
      utmSource: '<script>',
      extra: 'field',
    });
    expect(bad.success).toBe(false);
    const problems = fieldProblems(bad.error!);
    expect(Object.keys(problems)).toEqual(
      expect.arrayContaining([
        'name',
        'businessName',
        'email',
        'whatsapp',
        'consent',
        'branches',
        'utmSource',
      ]),
    );
    expect(problems.businessName).toBe('At least 2 characters, please.');
    expect(problems.consent).toContain('Tick this');
    expect(problems.branches).toBe('Choose one of these.');
    // Hidden characters (a zero-width space) aren't let in either.
    expect(EarlyAccessInput.safeParse({ ...business, city: 'Lah\u200Bore' }).success).toBe(false);
  });
});

describe('Early access: on the server', () => {
  it('is available with every setting, in memory only when asked and never on the live site', () => {
    expect(earlyAccessSettings()).toBeNull();
    vi.stubEnv('EARLY_ACCESS_TEST_STORE', 'true');
    expect(earlyAccessSettings()).toBe('test');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(earlyAccessSettings()).toBeNull();
    vi.stubEnv('SUPABASE_URL', 'http://abc.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'k');
    vi.stubEnv('TURNSTILE_SITE_KEY', 's');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 't');
    vi.stubEnv('EARLY_ACCESS_HASH_SECRET', 'y'.repeat(32));
    expect(earlyAccessSettings()).toBeNull(); // not https
    vi.stubEnv('SUPABASE_URL', 'https://abc.supabase.co');
    expect(earlyAccessSettings()).toMatchObject({ supabaseUrl: 'https://abc.supabase.co' });
  });

  it('scrambles an address with a key: the same address matches itself, nothing else, and can’t be read back', () => {
    const a = hashAddress('203.0.113.7', 'k'.repeat(32));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAddress('203.0.113.7', 'k'.repeat(32))).toBe(a);
    expect(hashAddress('203.0.113.8', 'k'.repeat(32))).not.toBe(a);
    expect(hashAddress('203.0.113.7', 'j'.repeat(32))).not.toBe(a);
    expect(a).not.toContain('203');
  });

  it('asks Cloudflare once per token, and believes only a clear yes for this form', async () => {
    const answer = (body: unknown, ok = true) =>
      vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as unknown as Response));
    const yes = answer({ success: true, action: 'early_access' });
    expect(await passedBotCheck('secret', 'token', '203.0.113.7', yes)).toBe(true);
    const sent = yes.mock.calls[0] as unknown as [string, RequestInit];
    expect(sent[0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect((sent[1].body as URLSearchParams).toString()).toContain('remoteip=203.0.113.7');
    expect(await passedBotCheck('secret', undefined, undefined, yes)).toBe(false);
    expect(await passedBotCheck('secret', 't', undefined, answer({ success: false }))).toBe(false);
    expect(await passedBotCheck('secret', 't', undefined, answer({ success: true, action: 'login' }))).toBe(
      false,
    );
    expect(await passedBotCheck('secret', 't', undefined, answer({}, false))).toBe(false);
    const down = vi.fn(() => Promise.reject(new Error('offline')));
    expect(await passedBotCheck('secret', 't', undefined, down)).toBe(false);
  });

  it('keeps a signup through join_waitlist only, with the key where Supabase expects it', async () => {
    const input = EarlyAccessInput.parse(business);
    const supabase = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve('joined') } as unknown as Response),
    );
    expect(await saveSignup(settings, input, 'a'.repeat(64), supabase)).toBe('joined');
    const [url, init] = supabase.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abc.supabase.co/rest/v1/rpc/join_waitlist');
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_secret_test');
    expect(headers.authorization).toBeUndefined(); // the newer secret keys aren't tokens
    expect(JSON.parse(init.body as string)).toEqual(rowOf(input, 'a'.repeat(64)));

    const legacy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve('already') } as unknown as Response),
    );
    await saveSignup({ ...settings, supabaseKey: 'eyJhbGciOi.legacy' }, input, null, legacy);
    const legacyHeaders = (legacy.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(legacyHeaders.authorization).toBe('Bearer eyJhbGciOi.legacy');

    const odd = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve('surprise') } as unknown as Response),
    );
    await expect(saveSignup(settings, input, null, odd)).rejects.toThrow();
    const failing = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve(null) } as unknown as Response),
    );
    await expect(saveSignup(settings, input, null, failing)).rejects.toThrow('500');
  });

  it('the tests’ store follows the same rules: one per email and kind, five an hour from one address', () => {
    const input = EarlyAccessInput.parse({ ...business, email: `t${Date.now()}@example.com` });
    const at = 1_000_000_000_000;
    expect(saveToTestStore(input, null, at)).toBe('joined');
    expect(saveToTestStore(input, null, at)).toBe('already');
    expect(saveToTestStore({ ...input, kind: 'customer' }, null, at)).toBe('joined');
    const address = 'b'.repeat(64);
    for (let i = 0; i < 5; i++)
      expect(saveToTestStore({ ...input, email: `r${i}.${at}@example.com` }, address, at)).toBe('joined');
    expect(saveToTestStore({ ...input, email: `r6.${at}@example.com` }, address, at)).toBe('slow_down');
    expect(saveToTestStore({ ...input, email: `r7.${at}@example.com` }, address, at + 3_600_001)).toBe(
      'joined',
    );
  });
});

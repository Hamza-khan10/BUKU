import { describe, expect, it } from 'vitest';
import { signPaddleBody, verifyPaddleSignature } from '../src/paddle/signature.js';

const SECRET = 'pdl_ntfset_test_secret';
const body = Buffer.from('{"event_id":"evt_1","event_type":"subscription.created","data":{}}');
const now = 1_800_000_000_000;
const ts = now / 1000;

describe('Paddle webhook signatures', () => {
  it('accepts a correctly signed, fresh delivery', () => {
    expect(verifyPaddleSignature(body, signPaddleBody(body, SECRET, ts), SECRET, 300, now)).toEqual({
      ok: true,
    });
  });

  it('refuses a changed body, a wrong secret, or no / broken header', () => {
    const header = signPaddleBody(body, SECRET, ts);
    expect(
      verifyPaddleSignature(Buffer.from(body.toString().replace('evt_1', 'evt_2')), header, SECRET, 300, now),
    ).toEqual({ ok: false, reason: 'mismatch' });
    expect(verifyPaddleSignature(body, signPaddleBody(body, 'other', ts), SECRET, 300, now)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(verifyPaddleSignature(body, undefined, SECRET, 300, now)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verifyPaddleSignature(body, 'h1=abc', SECRET, 300, now)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyPaddleSignature(body, `ts=${ts};h1=zz`, SECRET, 300, now)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('refuses old (replayed) and far-future deliveries', () => {
    expect(verifyPaddleSignature(body, signPaddleBody(body, SECRET, ts - 301), SECRET, 300, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verifyPaddleSignature(body, signPaddleBody(body, SECRET, ts + 301), SECRET, 300, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('accepts any of several signatures (secret rotation)', () => {
    const good = signPaddleBody(body, SECRET, ts).split(';h1=')[1];
    expect(verifyPaddleSignature(body, `ts=${ts};h1=${'0'.repeat(64)};h1=${good}`, SECRET, 300, now)).toEqual(
      { ok: true },
    );
  });
});

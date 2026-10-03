import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  matchingStep,
  newRecoveryCodes,
  newSecret,
  otpauthUri,
  stepAt,
} from '../src/mfa/totp.js';

// RFC 6238 Appendix B (SHA-1) and RFC 4226 Appendix D use the ASCII secret "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('Authenticator codes (RFC 6238 / RFC 4226)', () => {
  it('match the RFC 4226 HOTP test vectors', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expect(expected.map((_, i) => hotp(RFC_SECRET, BigInt(i)))).toEqual(expected);
  });

  it('match the RFC 6238 TOTP test vectors (8 digits, SHA-1)', () => {
    for (const [seconds, code] of [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ] as const) {
      expect(hotp(RFC_SECRET, stepAt(seconds * 1000), 8)).toBe(code);
    }
  });

  it('accept the current step and one either side (clock drift), nothing older; only 6 digits', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const at = (s: bigint) => hotp(RFC_SECRET, s);
    expect(matchingStep(secret, at(step), now)).toBe(step);
    expect(matchingStep(secret, at(step - 1n), now)).toBe(step - 1n);
    expect(matchingStep(secret, at(step + 1n), now)).toBe(step + 1n);
    expect(matchingStep(secret, at(step - 2n), now)).toBeNull();
    expect(matchingStep(secret, '12345', now)).toBeNull();
    expect(matchingStep(secret, 'abcdef', now)).toBeNull();
  });

  it('base32 round-trips; secrets are 160 bits; the QR link has what apps need', () => {
    const s = newSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
    const uri = otpauthUri(s, 'admin@buku.app');
    expect(uri).toMatch(
      /^otpauth:\/\/totp\/BUKU%3Aadmin%40buku\.app\?secret=[A-Z2-7]+&issuer=BUKU&algorithm=SHA1&digits=6&period=30$/,
    );
  });

  it('recovery codes: ten, unique, no look-alike characters', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });
});

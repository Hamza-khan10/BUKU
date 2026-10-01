import { describe, expect, it } from 'vitest';
import { matchesSignature } from '../src/file-types.js';

describe('file signatures', () => {
  const pdf = Buffer.from('%PDF-1.7\n%\xe2\xe3', 'latin1');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
  const html = Buffer.from('<html><script>alert(1)</script>');
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ" Windows executable

  it('accepts real files of the declared type', () => {
    expect(matchesSignature('application/pdf', pdf)).toBe(true);
    expect(matchesSignature('image/jpeg', jpeg)).toBe(true);
    expect(matchesSignature('image/png', png)).toBe(true);
    expect(matchesSignature('image/webp', webp)).toBe(true);
  });

  it('rejects disguised files', () => {
    for (const bad of [html, exe, png]) expect(matchesSignature('application/pdf', bad)).toBe(false);
    expect(matchesSignature('image/jpeg', exe)).toBe(false);
    expect(matchesSignature('image/png', jpeg)).toBe(false);
    expect(matchesSignature('image/webp', Buffer.from('RIFF1234AVI '))).toBe(false);
  });
});

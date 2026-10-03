import { describe, expect, it } from 'vitest';
import { normalizeText, stripDisallowed, textProblem, zText } from '../src/index.js';

const ok = (v: string, kind: Parameters<typeof textProblem>[1]) => textProblem(normalizeText(v, kind), kind);

describe('Clean text', () => {
  it('accepts real names in any script', () => {
    for (const name of [
      'Ayesha Noor Khan',
      'عائشہ نور خان',
      'José Álvarez',
      "Seán O'Brien",
      'Jean-Luc Picard',
      '李雷',
      'Ангелина',
      'देवनागरी', // Devanagari with combining marks
      'Dr. A. Rahman',
      'میں\u200Cہوں', // a zero-width non-joiner between letters (Urdu/Persian shaping)
    ]) {
      expect(ok(name, 'personName')).toBeNull();
    }
  });

  it('refuses emoji of every kind', () => {
    for (const v of [
      'Ali 😀',
      'Ali 👍🏽',
      'Pakistan 🇵🇰',
      'Love ❤\uFE0F',
      'Call 1\uFE0F⃣',
      'Shop ©',
      '👨\u200D👩\u200D👧 family',
      'Star ⭐',
    ]) {
      expect([v, ok(v, 'text')]).toEqual([v, 'emoji']);
      expect(ok(v, 'title')).toBe('emoji');
    }
  });

  it('refuses invisible and spoofing characters', () => {
    for (const v of [
      'Ali\u200BKhan', // zero-width space
      'admin\u202Egnp.exe', // right-to-left override ("Trojan source")
      'Ali\uFEFFKhan', // byte-order mark (inside: at the edges trimming removes it)
      'Al\u00ADi', // soft hyphen
      'Ali\u200D', // a joiner not between letters
    ]) {
      expect([JSON.stringify(v), ok(v, 'line')]).toEqual([JSON.stringify(v), 'invisible']);
    }
  });

  it('refuses control and private-use characters', () => {
    expect(ok('Ali\u0007Khan', 'line')).toBe('control');
    expect(ok('Ali\uE000', 'line')).toBe('characters');
  });

  it("names: only letters and . ' -; titles also digits and & , ( ) / + # : !", () => {
    expect(ok('Ali_Khan', 'personName')).toBe('characters');
    expect(ok('Ali 2', 'personName')).toBe('characters');
    expect(ok('Salt & Pepper Barbers (DHA) #2', 'title')).toBeNull();
    expect(ok('نائی کی دکان، لاہور۔', 'title')).toBeNull();
    expect(ok('Best <script>', 'title')).toBe('characters');
  });

  it('normalises: styled and full-width letters become ordinary; spaces collapse', () => {
    expect(normalizeText('𝐁𝐔𝐊𝐔   𝓢𝓪𝓵𝓸𝓷', 'title')).toBe('BUKU Salon');
    expect(normalizeText('ＢＵＫＵ', 'title')).toBe('BUKU');
    expect(normalizeText('  Ali   Khan  ', 'personName')).toBe('Ali Khan');
  });

  it('free text keeps up to two line breaks; one-line kinds refuse them', () => {
    expect(normalizeText('Great\r\n\n\n\nvisit  here', 'text')).toBe('Great\n\nvisit here');
    expect(ok('Great\n\nvisit', 'text')).toBeNull();
    expect(normalizeText('Street 1\nLahore', 'line')).toBe('Street 1 Lahore');
  });

  it('names we did not ask for (e.g. from Google) are cleaned, not refused', () => {
    expect(stripDisallowed('John 🎸 Smith', 'personName')).toBe('John Smith');
    expect(stripDisallowed('\u202EAyesha\u200B Khan ✨', 'personName')).toBe('Ayesha Khan');
    expect(stripDisallowed('🎉🎉', 'personName')).toBe('');
  });

  it('zText: normalises, refuses with a human message, bounds after normalising', () => {
    const schema = zText({ kind: 'personName', min: 1, max: 10 });
    expect(schema.parse('  Ali  ')).toBe('Ali');
    const bad = schema.safeParse('Ali 😀');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Emojis and picture symbols can’t be used here.');
    expect(schema.safeParse('A very long name indeed').success).toBe(false);
  });
});

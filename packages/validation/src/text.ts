/**
 * What text BUKU accepts (WEB_PLAN §6, D-083). One set of rules for the API
 * (authoritative) and the apps (instant feedback). Browser-safe: no Node APIs.
 *
 * Refused everywhere: emoji and pictographs (incl. flags, keycaps, skin tones,
 * variation selectors), control characters, invisible "format" characters
 * (zero-width spaces, bidirectional overrides used for spoofing, byte-order
 * marks, soft hyphens), private-use and unassigned code points. Zero-width
 * joiners are allowed only between letters, where Urdu, Persian and Indic
 * scripts legitimately need them.
 *
 * Kinds narrow it further:
 *  • personName — letters of any script, combining marks, spaces, . ' -
 *  • title      — names of businesses, services, categories: + digits & , ( ) / + # : !
 *  • line       — one line of ordinary text (addresses, short notes)
 *  • text       — free text with line breaks (reviews, descriptions)
 *
 * Names and titles are normalised with NFKC (so "𝓕𝓪𝓷𝓬𝔂" styled letters and
 * full-width characters become ordinary ones); free text with NFC.
 */

export type TextKind = 'personName' | 'title' | 'line' | 'text';

// Emoji and pictographs, plus the pieces emoji sequences are built from.
// (Joiners and combining marks are written as alternatives, not inside [...]:
// a character class would treat a joined sequence as if it were one character.)
const PICTOGRAPHIC =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0E}|\u{FE0F}|\u{20E3}|[\u{E0020}-\u{E007F}]/u;
// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const UNASSIGNED_OR_PRIVATE = /[\p{Co}\p{Cn}\p{Cs}]/u;
/** Format characters except ZWNJ/ZWJ (checked separately: allowed between letters only). */
const FORMAT = /(?!\u200C|\u200D)\p{Cf}/u;
const JOINER_NOT_BETWEEN_LETTERS = /(?<![\p{L}\p{M}])(?:\u200C|\u200D)|(?:\u200C|\u200D)(?![\p{L}\p{M}])/u;

const ALLOWED: Record<Exclude<TextKind, 'text' | 'line'>, RegExp> = {
  personName: /^(?:[\p{L}\p{M} .'’-]|\u200C|\u200D)*$/u,
  // Includes the Arabic comma and full stop used in Urdu.
  title: /^(?:[\p{L}\p{M}\p{N} .,'’&()/+#:!\u060C\u06D4-]|\u200C|\u200D)*$/u,
};

// Unicode's own White_Space set. (JavaScript's \s also matches U+FEFF, the
// byte-order mark, which must be refused as invisible, not turned into a space.)
const LINE_BREAKS = /\r\n?|[\u0085\u2028\u2029]/g;
const SPACES = /(?:(?!\n)\p{White_Space})+/gu;
const ANY_SPACE = /\p{White_Space}+/gu;

/** Normalise: Unicode form, trimmed, runs of spaces collapsed; free text keeps (at most two) line breaks. */
export function normalizeText(value: string, kind: TextKind): string {
  const form = kind === 'personName' || kind === 'title' ? 'NFKC' : 'NFC';
  let s = value.normalize(form).replace(LINE_BREAKS, '\n');
  if (kind === 'text') {
    s = s
      .split('\n')
      .map((line) => line.replace(SPACES, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    // One-line kinds: a pasted line break becomes a space.
    s = s.replace(ANY_SPACE, ' ');
  }
  return s.trim();
}

export type TextProblem = 'emoji' | 'invisible' | 'control' | 'characters' | 'line_breaks';

export const TEXT_PROBLEM_MESSAGES: Record<TextProblem, string> = {
  emoji: 'Emojis and picture symbols can’t be used here.',
  invisible: 'This contains invisible or special formatting characters — please retype it.',
  control: 'This contains special control characters — please retype it.',
  characters: 'Please use letters, numbers and ordinary punctuation only.',
  line_breaks: 'Please keep this on one line.',
};

/** The first thing wrong with a (normalised) value, or null if it's acceptable. */
export function textProblem(value: string, kind: TextKind): TextProblem | null {
  if (PICTOGRAPHIC.test(value)) return 'emoji';
  if (FORMAT.test(value) || JOINER_NOT_BETWEEN_LETTERS.test(value)) return 'invisible';
  if (kind !== 'text' && value.includes('\n')) return 'line_breaks';
  if (CONTROL.test(value.replace(/\n/g, ''))) return 'control';
  if (UNASSIGNED_OR_PRIVATE.test(value)) return 'characters';
  if (kind === 'personName' || kind === 'title') {
    if (!ALLOWED[kind].test(value)) return 'characters';
  }
  return null;
}

/** Hint for a person's name: what we accept. */
export const KIND_HINTS: Record<TextKind, string> = {
  personName: "Letters, spaces, and . ' - only.",
  title: "Letters, numbers, spaces and & , ( ) / + # : ! . ' - only.",
  line: 'One line of ordinary text.',
  text: 'Ordinary text; no emojis.',
};

/**
 * For text we didn't ask the person to type (e.g. a name from their Google
 * account): remove what isn't allowed instead of refusing it.
 */
export function stripDisallowed(value: string, kind: TextKind): string {
  let s = normalizeText(value, kind)
    .replace(new RegExp(PICTOGRAPHIC.source, 'gu'), '')
    .replace(new RegExp(FORMAT.source, 'gu'), '')
    .replace(new RegExp(JOINER_NOT_BETWEEN_LETTERS.source, 'gu'), '')
    .replace(new RegExp(UNASSIGNED_OR_PRIVATE.source, 'gu'), '');
  // eslint-disable-next-line no-control-regex -- removing control characters
  s = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/gu, '');
  if (kind === 'personName' || kind === 'title') {
    const allowed = ALLOWED[kind];
    s = [...s].filter((ch) => allowed.test(ch)).join('');
  }
  return normalizeText(s, kind);
}

/**
 * While someone is typing: remove, character by character, what this kind
 * never accepts (emoji, invisible and control characters; for names and
 * titles anything outside their letters and punctuation). Spacing is left as
 * typed and joiners are left for the final check — normalising happens when
 * the field is done (normalizeText), so typing "Ali " keeps its space.
 */
export function removeDisallowed(value: string, kind: TextKind): string {
  let s = value
    .replace(new RegExp(PICTOGRAPHIC.source, 'gu'), '')
    .replace(new RegExp(FORMAT.source, 'gu'), '')
    .replace(new RegExp(UNASSIGNED_OR_PRIVATE.source, 'gu'), '')
    .replace(new RegExp(CONTROL.source, 'gu'), '');
  if (kind === 'personName' || kind === 'title') {
    const allowed = ALLOWED[kind];
    s = [...s].filter((ch) => allowed.test(ch)).join('');
  }
  return s;
}

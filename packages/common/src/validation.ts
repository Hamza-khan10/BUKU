import { stripDisallowed, type TextKind, zText } from '@buku/validation';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

/**
 * Reusable Zod building blocks. Every endpoint validates body, query and
 * params with schemas composed from these, so the same input is judged the
 * same way everywhere.
 */

export const zUuid = z.uuid({ message: 'must be a valid UUID' });

/** Emails are compared and blind-indexed in lowercase; normalize at the edge. */
export const zEmail = z
  .string()
  .trim()
  .max(254)
  .toLowerCase()
  .pipe(z.email({ message: 'must be a valid email address' }));

/** E.164 phone numbers only: "+" then 7–15 digits, no spaces. */
export const zPhone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'must be an E.164 phone number, e.g. +923001234567');

/** IANA timezone name validated against the runtime's timezone database. */
export const zTimezone = z
  .string()
  .max(60)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'must be a valid IANA timezone, e.g. Asia/Karachi');

/** 24h wall-clock time "HH:MM". */
export const zTimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24h)');

export const zCurrency = z
  .string()
  .length(3)
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 currency code');

// eslint-disable-next-line no-control-regex -- the whole point is to match control characters
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Strip all HTML and control characters from user-supplied text before it is
 * stored. BUKU never renders user HTML, so nothing is allowed through. This is
 * defense in depth; the frontend still escapes on output.
 *
 * The result is PLAIN text: "Salt & Pepper" stays exactly that (not
 * "Salt &amp; Pepper", which apps would display literally). Tags hidden as
 * entities ("&lt;script&gt;") are decoded and stripped too: we repeat until the
 * text no longer changes, so the stored value never contains a tag.
 */
export function sanitizeText(input: string): string {
  let text = input;
  for (let pass = 0; pass < 5; pass++) {
    const next = stripTags(text);
    if (next === text) break;
    text = next;
  }
  // Still changing after several passes: adversarial nesting. Drop angle brackets entirely.
  if (stripTags(text) !== text) text = text.replace(/[<>]/g, '');
  return text.replace(CONTROL_CHARS, '').normalize('NFC').trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };

/** Remove tags, then turn the escaping sanitize-html adds back into plain characters. */
function stripTags(input: string): string {
  const html = sanitizeHtml(input, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: 'discard' });
  return html.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, name: string) => ENTITIES[name]!);
}

/**
 * A text field: HTML stripped (sanitizeText), then the clean-text rules for
 * its kind (@buku/validation, D-083): normalised, and refused with a human
 * message if it contains emoji, invisible or control characters, or — for
 * names and titles — anything but letters and ordinary punctuation. Bounds
 * apply after cleaning.
 *
 * `strip: true` removes what isn't allowed instead of refusing it: only for
 * text the person didn't type into our form (e.g. a device's name).
 */
export const zSafeText = (options: { kind: TextKind; min?: number; max: number; strip?: boolean }) =>
  z
    .string()
    .transform((v) => (options.strip ? stripDisallowed(sanitizeText(v), options.kind) : sanitizeText(v)))
    .pipe(zText(options));

/**
 * Password policy, aligned with NIST SP 800-63B: length over composition rules.
 * Upper bound prevents hashing-DoS with megabyte-long passwords.
 */
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
export const zPassword = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(128, 'must be at most 128 characters')
  .refine(
    (pw) => !COMMON_PASSWORDS.has(pw.toLowerCase()),
    'is too common; choose a less predictable password',
  )
  .refine((pw) => new Set(pw).size >= 4, 'must not be a repetition of a few characters');

/** Offset pagination: `?page=1&limit=20`. */
export const zPagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof zPagination>;

export function toSkipTake(p: Pagination): { skip: number; take: number } {
  return { skip: (p.page - 1) * p.limit, take: p.limit };
}

/**
 * Request bodies reject unknown keys, so clients cannot smuggle fields like
 * `role` or `status` into a create/update (mass-assignment protection).
 */
export const zBody = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

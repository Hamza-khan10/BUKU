import { z } from 'zod';
import { normalizeText, textProblem, TEXT_PROBLEM_MESSAGES } from './text';

/**
 * Kinds of business that owners add when BUKU doesn't list theirs yet (D-098). The list is
 * shared by everyone, so a new name is held to more than the usual title rules: letters (any
 * script), numbers, spaces and `& ' -` only — no brackets, slashes, emoji or invisible
 * characters — 2 to 40 characters, at least two of them letters. Two names that mean the same
 * ("Barber Shop", "barbershops", "BARBER-SHOP") share one key, and a key can exist only once.
 */

export const CATEGORY_NAME_MAX = 40;

const ALLOWED = /^[\p{L}\p{M}\p{N} &'’-]+$/u;

/**
 * Why a suggested name can't be used, or null. `value` should already be normalised
 * (`normalizeText(value, 'title')`).
 */
export function categoryNameProblem(value: string): string | null {
  if (value.length < 2) return 'Write the kind of business, like “Tattoo studio”.';
  if (value.length > CATEGORY_NAME_MAX) return `Keep it to ${CATEGORY_NAME_MAX} characters or fewer.`;
  const problem = textProblem(value, 'title');
  if (problem) return TEXT_PROBLEM_MESSAGES[problem];
  if (!ALLOWED.test(value)) return "Letters, numbers, spaces and & ' - only.";
  if ((value.match(/\p{L}/gu) ?? []).length < 2) return 'Use words: at least two letters.';
  return null;
}

/** A suggested kind of business's name: cleaned the way the API cleans it, then checked. */
export const zCategoryName = z
  .string()
  .transform((v) => normalizeText(v, 'title'))
  .superRefine((v, ctx) => {
    const problem = categoryNameProblem(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/**
 * The key two names share when they mean the same: lower case, "&" read as "and", only letters
 * and numbers kept (any script), and one plural "s" dropped from the end of a longer word.
 * "Barber Shops" → "barbershop"; "Health & Medical" → "healthandmedical".
 */
export function categoryKey(name: string): string {
  const key = name
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replaceAll('&', 'and')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return key.length > 3 && key.endsWith('s') ? key.slice(0, -1) : key;
}

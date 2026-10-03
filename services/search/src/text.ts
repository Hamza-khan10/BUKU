/**
 * Turning what people type into safe search input (pure, unit-tested).
 * Nothing typed ever reaches SQL as syntax: values are bound parameters, the
 * full-text query is rebuilt from plain word characters only, and LIKE
 * wildcards are escaped.
 */

export const MAX_QUERY_LENGTH = 100;
const MAX_WORDS = 8;

/** Same text however it was typed: Unicode-normalised, trimmed, single spaces, bounded. */
export function normalizeQuery(q: string): string {
  return q.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

/** The words in a query (letters and digits in any script). */
export function words(q: string): string[] {
  return (
    normalizeQuery(q)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).slice(0, MAX_WORDS);
}

/**
 * A prefix full-text query: "hair sal" → "hair:* & sal:*", so results appear
 * while the last word is still being typed. Null when there are no words.
 */
export function prefixTsQuery(q: string): string | null {
  const w = words(q);
  return w.length ? w.map((x) => `${x}:*`).join(' & ') : null;
}

/** For ILIKE patterns: `%`, `_` and `\` match themselves. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * What search analytics may keep of a query: people sometimes type phone
 * numbers or emails into a search box, and those must not end up in
 * analytics. Lower-cased; anything that looks like contact details is replaced.
 */
export function queryForAnalytics(q: string): string {
  const n = normalizeQuery(q).toLowerCase();
  if (/@/.test(n) || /\d[\d\s()+-]{5,}\d/.test(n)) return '[redacted]';
  return n;
}

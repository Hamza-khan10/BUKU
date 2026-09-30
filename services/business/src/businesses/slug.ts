import { randomBytes } from 'node:crypto';

/** "Fade Masters", "Lahore" → "fade-masters-lahore" (ASCII only; accents folded). */
export function slugify(...parts: string[]): string {
  return parts
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Names in non-Latin scripts (e.g. Urdu) produce an empty slug: fall back to a random one. */
export function candidateSlugs(name: string, city: string): string[] {
  const base = slugify(name, city) || `business-${randomBytes(3).toString('hex')}`;
  return [base, ...Array.from({ length: 5 }, () => `${base}-${randomBytes(2).toString('hex')}`)];
}

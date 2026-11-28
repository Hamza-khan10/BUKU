import type { Receipt } from './types';

/** Services people actually went for, newest first, each place and service once. */
export function bookAgain(past: Receipt[]): Receipt[] {
  const seen = new Set<string>();
  return past.filter((r) => {
    const key = `${r.business.id}:${r.service.id}`;
    const went = r.status === 'completed' || r.checkedInAt !== null;
    if (!went || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

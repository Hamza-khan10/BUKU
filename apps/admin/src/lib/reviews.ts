/** A review as platform admins see it in moderation (booking's admin view). */
export interface AdminReview {
  id: string;
  rating: {
    overall: number;
    waitTime: number | null;
    staff: number | null;
    cleanliness: number | null;
    value: number | null;
  };
  comment: string | null;
  author: string;
  service: string | null;
  staff: string | null;
  visitedIn: string | null;
  createdAt: string;
  edited: boolean;
  response: { text: string; at: string } | null;
  business: { id: string; slug: string; name: string };
  visible: boolean;
  report: { reason: string | null; at: string | null };
  hidden: { at: string; reason: string | null } | null;
}

const REASONS: Record<string, string> = {
  offensive: 'Offensive',
  fake: 'Fake review',
  not_a_customer: 'Not a customer',
  personal_info: 'Personal information',
  other: 'Something else',
};

/** "fake: No such booking" → the reason in words, and the business's note. */
export function reportOf(raw: string | null): { reason: string; note: string | null } {
  if (!raw) return { reason: 'Reported', note: null };
  const [key, ...rest] = raw.split(': ');
  const note = rest.join(': ').trim();
  return { reason: REASONS[key!] ?? key!.replaceAll('_', ' '), note: note || null };
}

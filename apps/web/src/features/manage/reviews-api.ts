import { api, apiCall } from '@/lib/api/client';
import type { Review, ReviewsMeta } from '@/features/business/types';

/** A review as its business's team sees it (3.5i): the public view, plus what the team did and BUKU's hiding. */
export interface TeamReview extends Review {
  visible: boolean;
  reported: { reason: string | null; at: string | null } | null;
  hiddenAt: string | null;
}

export type TeamReviewFilter = 'all' | 'unanswered' | 'reported' | 'hidden';

export interface TeamReviewsMeta extends ReviewsMeta {
  counts: { unanswered: number; reported: number; hidden: number };
}

export const REPORT_REASONS = {
  fake: 'Fake: not a real visit',
  not_a_customer: 'Not one of our customers',
  offensive: 'Offensive or abusive',
  personal_info: 'Shares someone’s personal details',
  other: 'Something else',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export const teamReviewsKey = (id: string, filter: TeamReviewFilter, rating: number | null, page: number) =>
  ['business', id, 'reviews', filter, rating ?? 0, page] as const;
export const allTeamReviewsKey = (id: string) => ['business', id, 'reviews'] as const;

export function fetchTeamReviews(id: string, filter: TeamReviewFilter, rating: number | null, page: number) {
  const q = new URLSearchParams({ filter, page: String(page), limit: '20' });
  if (rating) q.set('rating', String(rating));
  return apiCall<TeamReview[], TeamReviewsMeta>(`businesses/${id}/reviews/manage?${q}`);
}

const path = (id: string, reviewId: string) => `businesses/${id}/reviews/${reviewId}`;
export const replyToReview = (id: string, reviewId: string, text: string) =>
  api<unknown>(`${path(id, reviewId)}/response`, { method: 'PUT', body: { text } });
export const removeReply = (id: string, reviewId: string) =>
  api<unknown>(`${path(id, reviewId)}/response`, { method: 'DELETE' });
export const reportReview = (id: string, reviewId: string, reason: ReportReason, note: string | undefined) =>
  api<unknown>(`${path(id, reviewId)}/report`, { method: 'POST', body: { reason, ...(note && { note }) } });

import { api, apiCall } from '@/lib/api/client';
import type { MyReview, Ratings } from './types';

export const MY_REVIEWS_KEY = ['my-reviews'] as const;

export interface MyReviewsPage {
  items: MyReview[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/** My reviews, newest first. */
export async function fetchMyReviews(page = 1, limit = 50): Promise<MyReviewsPage> {
  const res = await apiCall<MyReview[], MyReviewsPage['meta']>('appointments/reviews', {
    query: { page, limit },
  });
  return { items: res.data, meta: res.meta ?? { page, limit, total: res.data.length, totalPages: 1 } };
}

export type ReviewInput = Ratings & { comment?: string | undefined };

const body = (input: ReviewInput) => {
  const out: Record<string, unknown> = { overall: input.overall };
  for (const k of ['waitTime', 'staff', 'cleanliness', 'value'] as const) if (input[k]) out[k] = input[k];
  if (input.comment) out.comment = input.comment;
  return out;
};

export const createReview = (appointmentId: string, input: ReviewInput) =>
  api<MyReview>(`appointments/${appointmentId}/review`, { method: 'POST', body: body(input) });

export const updateReview = (appointmentId: string, input: ReviewInput) =>
  api<MyReview>(`appointments/${appointmentId}/review`, { method: 'PATCH', body: body(input) });

export const deleteReview = (appointmentId: string) =>
  api<void>(`appointments/${appointmentId}/review`, { method: 'DELETE' });

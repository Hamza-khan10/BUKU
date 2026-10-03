'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiCall } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { Review, ReviewsMeta } from '../types';
import { ReviewCard } from './review-card';

/** More reviews, a page at a time, on request (no endless scroll). */
export function MoreReviews({
  slug,
  businessName,
  totalPages,
}: {
  slug: string;
  businessName: string;
  totalPages: number;
}) {
  const [pages, setPages] = useState<Review[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = pages.length + 2;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiCall<Review[], ReviewsMeta>(`businesses/${slug}/reviews`, {
        query: { page: next, limit: 6 },
      });
      setPages((p) => [...p, data]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'We couldn’t load more reviews.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {pages.length > 0 && (
        <ul className="flex flex-col gap-3">
          {pages.flat().map((r) => (
            <ReviewCard key={r.id} review={r} businessName={businessName} />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {next <= totalPages && (
        <div>
          <Button onClick={() => void load()} loading={loading}>
            Show more reviews
          </Button>
        </div>
      )}
    </>
  );
}

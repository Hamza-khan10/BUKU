import type { Metadata } from 'next';
import { MyReviews } from '@/features/reviews/components/my-reviews';

export const metadata: Metadata = { title: 'Your reviews', robots: { index: false, follow: false } };

export default function ReviewsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-4xl font-semibold tracking-[-0.03em]">Your reviews</h1>
      <MyReviews />
    </div>
  );
}

import type { Metadata } from 'next';
import { MyReviews } from '@/features/reviews/components/my-reviews';

export const metadata: Metadata = { title: 'Your reviews', robots: { index: false, follow: false } };

export default function ReviewsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="type-app-title">Your reviews</h1>
      <MyReviews />
    </div>
  );
}

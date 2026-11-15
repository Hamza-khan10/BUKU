import type { Metadata } from 'next';
import { BusinessReviews } from '@/features/manage/components/business-reviews';

export const metadata: Metadata = { title: 'Reviews', robots: { index: false, follow: false } };

export default async function BusinessReviewsPage({ params }: PageProps<'/business/[id]/reviews'>) {
  return <BusinessReviews id={(await params).id} />;
}

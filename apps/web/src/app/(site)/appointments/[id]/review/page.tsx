import { isPublicId } from '@buku/validation';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/layout';
import { ReviewPage } from '@/features/reviews/components/review-form';

export const metadata: Metadata = { title: 'Review your visit', robots: { index: false, follow: false } };

/** Reviewing a visit (or changing that review) — signed in, the visit's own customer only. */
export default async function ReviewVisitPage({ params }: PageProps<'/appointments/[id]/review'>) {
  const { id } = await params;
  if (!isPublicId(id)) notFound();
  return (
    <Container className="py-10 sm:py-14">
      <ReviewPage appointmentId={id} />
    </Container>
  );
}

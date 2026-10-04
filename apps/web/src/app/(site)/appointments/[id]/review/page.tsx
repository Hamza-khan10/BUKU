import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/layout';
import { ReviewPage } from '@/features/reviews/components/review-form';

export const metadata: Metadata = { title: 'Review your visit', robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reviewing a visit (or changing that review) — signed in, the visit's own customer only. */
export default async function ReviewVisitPage({ params }: PageProps<'/appointments/[id]/review'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <Container className="py-10 sm:py-14">
      <ReviewPage appointmentId={id} />
    </Container>
  );
}

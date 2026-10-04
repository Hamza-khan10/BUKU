import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/layout';
import { MoveFlow } from '@/features/booking/components/move-flow';

export const metadata: Metadata = { title: 'Move your visit', robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Moving a booking to another time (signed-in, owner only — like its receipt). */
export default async function MovePage({ params }: PageProps<'/appointments/[id]/move'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <Container className="py-10 sm:py-14">
      <MoveFlow id={id} />
    </Container>
  );
}

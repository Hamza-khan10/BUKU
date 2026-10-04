import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/layout';
import { ReceiptView } from '@/features/booking/components/receipt-view';

export const metadata: Metadata = {
  title: 'Your booking',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One booking's receipt, for the person who made it (signed-out visitors are
 * sent to sign in by the proxy; the API shows a booking only to its owner).
 * `?new=1` right after booking: the ticket "prints" and says so.
 */
export default async function AppointmentPage({ params, searchParams }: PageProps<'/appointments/[id]'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const fresh = (await searchParams).new === '1';
  return (
    <Container className="py-10 sm:py-14">
      <ReceiptView id={id} fresh={fresh} />
    </Container>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/layout';
import { QueueTicketView } from '@/features/queue/components/queue-ticket';

export const metadata: Metadata = { title: 'Your ticket', robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A queue ticket, live (signed-in, its owner only — the proxy sends
 * signed-out visitors to sign in, and the API shows a ticket only to them).
 * `?joined=1` right after joining.
 */
export default async function QueueTicketPage({ params, searchParams }: PageProps<'/queue/[entryId]'>) {
  const { entryId } = await params;
  if (!UUID.test(entryId)) notFound();
  const joined = (await searchParams).joined === '1';
  return (
    <Container className="py-10 sm:py-14">
      <QueueTicketView id={entryId} joined={joined} />
    </Container>
  );
}

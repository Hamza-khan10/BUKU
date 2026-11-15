import type { Metadata } from 'next';
import { QueuePage } from '@/features/manage/components/queue-board';

export const metadata: Metadata = { title: 'Queue', robots: { index: false, follow: false } };

export default async function BusinessQueuePage({ params }: PageProps<'/business/[id]/queue'>) {
  return <QueuePage id={(await params).id} />;
}

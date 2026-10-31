import type { Metadata, Route } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { loadQueueScreen } from '@/features/business/api';
import { QueueScreen } from '@/features/queue/components/queue-screen';
import { env } from '@/lib/env';

type Props = PageProps<'/b/[idOrSlug]/screen'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadQueueScreen((await params).idOrSlug);
  return {
    title: page ? `${page.business.name}: the queue` : 'Business not found',
    robots: { index: false, follow: false },
  };
}

/**
 * The waiting-room screen (3.5c, D-126): now calling, being served, and who's next, by ticket
 * number only — exactly what the business's public page shows. It needs no sign-in, so the TV in
 * the waiting room never holds a team member's login.
 */
export default async function QueueScreenPage({ params }: Props) {
  const { idOrSlug } = await params;
  const page = await loadQueueScreen(idOrSlug);
  if (!page) notFound();
  const { business, queue } = page;
  if (idOrSlug !== business.slug) permanentRedirect(`/b/${business.slug}/screen` as Route);
  return (
    <QueueScreen
      slug={business.slug}
      name={business.name}
      joinUrl={`${env().APP_URL}/b/${business.slug}`}
      initial={queue.ok ? queue.data : null}
    />
  );
}

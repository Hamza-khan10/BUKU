import type { Metadata } from 'next';
import { InsightsPage } from '@/features/manage/components/insights-page';
import { periodOf } from '@/features/manage/insights';

export const metadata: Metadata = { title: 'Insights', robots: { index: false, follow: false } };

/** Only 30, 90 or 365 days from the address reach the API; anything else is the default (90). */
export default async function BusinessInsightsPage({
  params,
  searchParams,
}: PageProps<'/business/[id]/insights'>) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <InsightsPage id={id} days={periodOf(query.days)} />;
}

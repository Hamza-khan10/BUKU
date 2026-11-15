import type { Metadata } from 'next';
import { TeamPage } from '@/features/manage/components/business-pages';

export const metadata: Metadata = { title: 'Team', robots: { index: false, follow: false } };

export default async function BusinessTeamPage({ params }: PageProps<'/business/[id]/team'>) {
  return <TeamPage id={(await params).id} />;
}

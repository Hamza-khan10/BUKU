import type { Metadata } from 'next';
import { HoursPage } from '@/features/manage/components/hours-page';

export const metadata: Metadata = { title: 'Hours', robots: { index: false, follow: false } };

export default async function BusinessHoursPage({ params }: PageProps<'/business/[id]/hours'>) {
  return <HoursPage id={(await params).id} />;
}

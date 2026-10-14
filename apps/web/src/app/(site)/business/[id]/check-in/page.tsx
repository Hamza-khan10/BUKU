import type { Metadata } from 'next';
import { CheckInPage } from '@/features/manage/components/check-in-page';

export const metadata: Metadata = { title: 'Check-in', robots: { index: false, follow: false } };

export default async function BusinessCheckInPage({ params }: PageProps<'/business/[id]/check-in'>) {
  return <CheckInPage id={(await params).id} />;
}

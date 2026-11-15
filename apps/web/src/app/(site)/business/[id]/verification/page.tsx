import type { Metadata } from 'next';
import { VerificationPage } from '@/features/manage/components/verification-page';

export const metadata: Metadata = { title: 'Verification', robots: { index: false, follow: false } };

export default async function BusinessVerificationPage({ params }: PageProps<'/business/[id]/verification'>) {
  return <VerificationPage id={(await params).id} />;
}

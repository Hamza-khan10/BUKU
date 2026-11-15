import type { Metadata } from 'next';
import { BillingPage } from '@/features/manage/components/billing-page';

export const metadata: Metadata = { title: 'Plan', robots: { index: false, follow: false } };

export default async function BusinessBillingPage({ params }: PageProps<'/business/[id]/billing'>) {
  return <BillingPage id={(await params).id} />;
}

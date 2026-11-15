import type { Metadata } from 'next';
import { ServicesPage } from '@/features/manage/components/business-pages';

export const metadata: Metadata = { title: 'Services', robots: { index: false, follow: false } };

export default async function BusinessServicesPage({ params }: PageProps<'/business/[id]/services'>) {
  return <ServicesPage id={(await params).id} />;
}

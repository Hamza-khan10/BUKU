import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BusinessHome } from '@/features/manage/components/business-home';

export const metadata: Metadata = { title: 'Your business', robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BusinessPage({ params }: PageProps<'/business/[id]'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <BusinessHome id={id} />;
}

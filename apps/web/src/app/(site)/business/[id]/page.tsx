import { isPublicId } from '@buku/validation';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BusinessHome } from '@/features/manage/components/business-home';

export const metadata: Metadata = { title: 'Your business', robots: { index: false, follow: false } };

export default async function BusinessPage({ params }: PageProps<'/business/[id]'>) {
  const { id } = await params;
  if (!isPublicId(id)) notFound();
  return <BusinessHome id={id} />;
}

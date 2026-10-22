import { isPublicId } from '@buku/validation';
import { notFound } from 'next/navigation';
import { BusinessNav } from '@/features/manage/components/business-nav';

/** One business's own pages, with their tabs. */
export default async function OneBusinessLayout({ children, params }: LayoutProps<'/business/[id]'>) {
  const { id } = await params;
  if (!isPublicId(id)) notFound();
  return (
    <>
      <BusinessNav id={id} />
      {children}
    </>
  );
}

import { notFound } from 'next/navigation';
import { BusinessNav } from '@/features/manage/components/business-nav';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One business's own pages, with their tabs. */
export default async function OneBusinessLayout({ children, params }: LayoutProps<'/business/[id]'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <>
      <BusinessNav id={id} />
      {children}
    </>
  );
}

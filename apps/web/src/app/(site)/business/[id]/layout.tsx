import { isPublicId } from '@buku/validation';
import { notFound } from 'next/navigation';
import { BusinessNav } from '@/features/manage/components/business-nav';

/**
 * One business's own pages: on a wide screen its pages in a rail beside the page; on a phone, a
 * bar under the header (BusinessNav draws both and shows the one that fits).
 */
export default async function OneBusinessLayout({ children, params }: LayoutProps<'/business/[id]'>) {
  const { id } = await params;
  if (!isPublicId(id)) notFound();
  return (
    <div className="flex flex-col gap-6 sm:gap-8 lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <BusinessNav id={id} />
      <div className="flex min-w-0 flex-col gap-8">{children}</div>
    </div>
  );
}

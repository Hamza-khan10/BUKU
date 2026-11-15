import { isPublicId } from '@buku/validation';
import { ArrowLeft } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeading } from '@/components/ui/layout';
import { SetupFlow } from '@/features/manage/components/setup-flow';

export const metadata: Metadata = { title: 'Set up your business', robots: { index: false, follow: false } };

export default async function SetupPage({ params }: PageProps<'/business/[id]/setup'>) {
  const { id } = await params;
  if (!isPublicId(id)) notFound();
  return (
    <>
      <PageHeading
        compact
        back={
          <Link
            href={`/business/${id}` as Route}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden /> Your business
          </Link>
        }
        eyebrow="Setting up"
        title="Almost there"
        description="Your opening hours, then the first thing people can book. Each step is saved as you go."
      />
      <SetupFlow id={id} />
    </>
  );
}

import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/layout';
import { ErrorState } from '@/components/ui/states';
import { NewBusinessForm } from '@/features/manage/components/new-business-form';
import { categoryTree } from '@/features/search/api';

export const metadata: Metadata = { title: 'Add your business', robots: { index: false, follow: false } };

export default async function NewBusinessPage() {
  const categories = await categoryTree().catch(() => null);
  return (
    <>
      <PageHeading
        compact
        eyebrow="For businesses"
        title="Add your business"
        description="About five minutes: what it is and where, then your opening hours and a first service. Your page goes live as soon as you finish."
      />
      {categories ? (
        <NewBusinessForm categories={categories} />
      ) : (
        <ErrorState
          title="This page isn’t loading right now"
          message="The list of kinds of business didn’t arrive. Please try again in a moment."
        />
      )}
    </>
  );
}

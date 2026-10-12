import type { Metadata } from 'next';
import { PageHeading } from '@/components/ui/layout';
import { MyBusinesses } from '@/features/manage/components/my-businesses';

export const metadata: Metadata = { title: 'Your businesses', robots: { index: false, follow: false } };

export default function BusinessesPage() {
  return (
    <>
      <PageHeading
        compact
        eyebrow="For businesses"
        title="Your businesses"
        description="The businesses you own or work at on BUKU."
      />
      <MyBusinesses />
    </>
  );
}

import type { Metadata } from 'next';
import { SettingsPage } from '@/features/manage/components/settings-page';

export const metadata: Metadata = { title: 'Settings', robots: { index: false, follow: false } };

export default async function BusinessSettingsPage({ params }: PageProps<'/business/[id]/settings'>) {
  return <SettingsPage id={(await params).id} />;
}
